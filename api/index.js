// Vercel serverless entry point.
// TypeScript is compiled to dist/ during the build step (npm run build).
// This loads the pre-compiled handler — NestJS requires emitDecoratorMetadata
// which is incompatible with Vercel's esbuild, so we pre-compile with tsc.
let handler;
try {
  handler = require('../dist/serverless').default;
} catch (err) {
  console.error('[api/index.js] Failed to load dist/serverless:', err);
  handler = (_req, res) => {
    res.status(500).json({ error: 'Server init failed', details: err.message, stack: err.stack });
  };
}

module.exports = handler;
