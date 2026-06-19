let appPromise;

module.exports = async function handler(req, res) {
  appPromise ??= import("../artifacts/api-server/dist/app.mjs").then(
    (module) => module.default,
  );

  const app = await appPromise;
  return app(req, res);
};
