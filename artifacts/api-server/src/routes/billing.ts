// @ts-nocheck
import { Router } from "express";
import Stripe from "stripe";
import { logger } from "../lib/logger.js";
import { getSupabaseUser } from "../lib/auth.js";
import { FREE_CREDITS, fulfillCheckout, getCredits, recordPendingCheckout } from "../lib/credits.js";

const router = Router();

const stripeSecretKey = process.env.STRIPE_SECRET_KEY;
const stripe = stripeSecretKey
  ? new Stripe(stripeSecretKey)
  : null;

const FALLBACK_30_PRICE_ID = "resumex100_30_credits_999";
const FALLBACK_100_PRICE_ID = "resumex100_100_credits_1999";

const fallbackPrices = [
  { id: null, credits: 5, price: "Free", label: "First 5 Resumes Free", popular: false },
  { id: FALLBACK_30_PRICE_ID, credits: 30, price: "$9.99", label: "30 resume credits", popular: true },
  { id: FALLBACK_100_PRICE_ID, credits: 100, price: "$19.99", label: "100 resume credits", popular: false },
];

function configuredPriceIds(): string[] {
  return [
    process.env.STRIPE_30_CREDITS_PRICE_ID,
    process.env.STRIPE_30_RESUME_CREDITS_PRICE_ID,
    process.env.STRIPE_PRICE_ID_30_CREDITS,
    process.env.PRICE_30_CREDITS,
    process.env.STRIPE_100_CREDITS_PRICE_ID ||
      process.env.STRIPE_100_RESUME_CREDITS_PRICE_ID ||
      process.env.STRIPE_100_RESUMES_PRICE_ID ||
      process.env.STRIPE_CREDITS_100_PRICE_ID ||
      process.env.STRIPE_RESUME_100_CREDITS_PRICE_ID ||
      process.env.STRIPE_RESUME_CREDITS_100_PRICE_ID ||
      process.env.STRIPE_PRICE_ID_100_CREDITS ||
      process.env.STRIPE_PRICE_100_CREDITS ||
      process.env.RESUMEX100_100_CREDITS_PRICE_ID ||
      process.env.PRICE_100_CREDITS,
  ].filter((id): id is string => typeof id === "string" && id.startsWith("price_"));
}

function formatPrice(price: Stripe.Price): string {
  const amount = price.unit_amount ?? 0;
  const currency = (price.currency ?? "usd").toUpperCase();
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency,
    maximumFractionDigits: amount % 100 === 0 ? 0 : 2,
  }).format(amount / 100);
}

function inferCredits(price: Stripe.Price): number {
  const product = typeof price.product === "object" ? price.product : null;
  const source = [
    price.metadata?.credits,
    price.metadata?.resume_credits,
    product?.metadata?.credits,
    product?.metadata?.resume_credits,
    product?.name,
    price.nickname,
  ].filter(Boolean).join(" ");
  const explicit = Number(price.metadata?.credits ?? price.metadata?.resume_credits ?? product?.metadata?.credits ?? product?.metadata?.resume_credits);
  if (Number.isFinite(explicit) && explicit > 0) return explicit;
  const match = source.match(/\b(\d+)\b/);
  if (match) return Number(match[1]);
  if (price.currency === "usd" && price.unit_amount === 999) return 30;
  if (price.currency === "usd" && price.unit_amount === 1999) return 100;
  return 1;
}

function normalizePlanLabel(credits: number) {
  return `${credits} resume credit${credits === 1 ? "" : "s"}`;
}

function mapStripePrice(price: Stripe.Price) {
  const product = typeof price.product === "object" ? price.product : null;
  const credits = inferCredits(price);
  return {
    id: price.id,
    credits,
    price: formatPrice(price),
    label: normalizePlanLabel(credits),
    popular: price.metadata?.popular === "true" || product?.metadata?.popular === "true" || credits === 30,
    savings: price.metadata?.savings ?? product?.metadata?.savings ?? undefined,
  };
}

router.get("/prices", async (_req, res) => {
  if (!stripe) {
    return res.json({
      source: "fallback",
      reason: "missing_stripe_secret_key",
      prices: fallbackPrices,
    });
  }

  try {
    const prices = await stripe.prices.list({
      active: true,
      type: "one_time",
      expand: ["data.product"],
      limit: 20,
    });
    const configured = await Promise.all(
      configuredPriceIds().map((id) => stripe.prices.retrieve(id, { expand: ["product"] }).catch(() => null))
    );

    const uniquePrices = [...configured.filter(Boolean), ...prices.data].filter((price, index, all) =>
      price && all.findIndex((candidate) => candidate?.id === price.id) === index
    ) as Stripe.Price[];

    const mapped = uniquePrices
      .filter((price) => price.unit_amount !== null && typeof price.product === "object" && price.product.active !== false)
      .sort((a, b) => (a.unit_amount ?? 0) - (b.unit_amount ?? 0))
      .map(mapStripePrice)
      .filter((plan) => plan.credits === 30 || plan.credits === 100)
      .slice(0, 3);

    if (!mapped.length) {
      return res.json({
        source: "fallback",
        reason: "stripe_returned_no_active_one_time_prices",
        prices: fallbackPrices,
      });
    }

    return res.json({ source: "stripe", prices: [fallbackPrices[0], ...mapped] });
  } catch (err) {
    logger.error({ err }, "Stripe prices failed");
    return res.json({
      source: "fallback",
      reason: err instanceof Error ? err.message : "stripe_prices_failed",
      prices: fallbackPrices,
    });
  }
});

router.get("/credits", async (req, res) => {
  const user = await getSupabaseUser(req);
  if (!user) return res.status(401).json({ error: "Sign in to view resume credits." });

  try {
    return res.json(await getCredits(user.id));
  } catch (err) {
    logger.error({ err, userId: user.id }, "Credit balance failed");
    return res.status(500).json({ error: "Could not load resume credits." });
  }
});

router.post("/checkout", async (req, res) => {
  if (!stripe) {
    return res.status(503).json({ error: "Stripe is not configured." });
  }

  const user = await getSupabaseUser(req);
  if (!user) return res.status(401).json({ error: "Sign in before buying resume credits." });

  const priceId = typeof req.body?.priceId === "string" ? req.body.priceId.trim() : "";
  const effectivePriceId = priceId;
  const isFallbackPlan = effectivePriceId === FALLBACK_30_PRICE_ID || effectivePriceId === FALLBACK_100_PRICE_ID;
  if (!effectivePriceId || (!effectivePriceId.startsWith("price_") && !isFallbackPlan)) {
    return res.status(400).json({ error: "A valid Stripe price is required." });
  }

  try {
    const price = isFallbackPlan
      ? null
      : await stripe.prices.retrieve(effectivePriceId, { expand: ["product"] });
    if (price && (!price.active || price.type !== "one_time")) {
        return res.status(400).json({ error: "This price is not available for one-time checkout." });
      }

    const forwardedProto = String(req.headers["x-forwarded-proto"] ?? req.protocol).split(",")[0].trim();
    const forwardedHost = String(req.headers["x-forwarded-host"] ?? req.get("host")).split(",")[0].trim();
    const origin = `${forwardedProto}://${forwardedHost}`;
    const credits = effectivePriceId === FALLBACK_30_PRICE_ID ? 30 : effectivePriceId === FALLBACK_100_PRICE_ID ? 100 : inferCredits(price);
    const fallbackAmount = effectivePriceId === FALLBACK_100_PRICE_ID ? 1999 : 999;
    const session = await stripe.checkout.sessions.create({
      mode: "payment",
      line_items: [
        isFallbackPlan
          ? {
              price_data: {
                currency: "usd",
                unit_amount: fallbackAmount,
                product_data: {
                  name: `ResumeX100 - ${credits} resume credits`,
                  metadata: { credits: String(credits), resume_credits: String(credits) },
                },
              },
              quantity: 1,
            }
          : { price: effectivePriceId, quantity: 1 },
      ],
      customer_email: user.email,
      client_reference_id: user.id,
      metadata: {
        userId: user.id,
        priceId: effectivePriceId,
        credits: String(credits),
      },
      success_url: `${origin}/app?checkout=success&session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${origin}/#pricing`,
    });

    try {
      await recordPendingCheckout(session.id, user.id, effectivePriceId, credits);
    } catch (pendingErr) {
      logger.warn({ err: pendingErr, sessionId: session.id, userId: user.id }, "Could not record pending Stripe checkout");
    }
    return res.json({ url: session.url });
  } catch (err) {
    logger.error({ err, priceId }, "Stripe checkout failed");
    return res.status(500).json({ error: "Could not start Stripe checkout." });
  }
});

router.post("/webhook", async (req, res) => {
  if (!stripe) return res.status(503).json({ error: "Stripe is not configured." });

  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!webhookSecret) return res.status(503).json({ error: "Stripe webhook secret is not configured." });

  const signature = req.headers["stripe-signature"];
  if (!signature) return res.status(400).json({ error: "Missing Stripe signature." });

  let event: Stripe.Event;
  try {
    const payload = req.rawBody ?? Buffer.from(JSON.stringify(req.body ?? {}));
    event = stripe.webhooks.constructEvent(payload, signature, webhookSecret);
  } catch (err) {
    logger.warn({ err }, "Invalid Stripe webhook signature");
    return res.status(400).json({ error: "Invalid Stripe webhook signature." });
  }

  if (event.type === "checkout.session.completed") {
    const session = event.data.object as Stripe.Checkout.Session;
    const userId = session.metadata?.userId ?? session.client_reference_id;
    const priceId = session.metadata?.priceId;
    const credits = Number(session.metadata?.credits ?? 0);
    if (session.payment_status === "paid" && userId && priceId && Number.isFinite(credits) && credits > 0) {
      await fulfillCheckout(session.id, userId, priceId, credits);
    }
  }

  return res.json({ received: true, freeCredits: FREE_CREDITS });
});

export default router;
