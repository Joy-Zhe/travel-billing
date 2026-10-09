const core = require("./core");
// Formatting must also work on runtimes without the Intl APIs used by the web app.
function money(amount, currency) {
  const c = core.CURRENCIES[currency],
    parts = (amount / Math.pow(10, c.digits)).toFixed(c.digits).split(".");
  parts[0] = parts[0].replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return c.symbol + parts.join(".");
}
function today() {
  return new Date(Date.now() + 8 * 3600000).toISOString().slice(0, 10);
}
module.exports = Object.assign({}, core, { money, today });
