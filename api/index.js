// Vercel serverless entry point.
// TypeScript is compiled to dist/ during the build step (npm run build).
// This file loads the pre-compiled handler so Vercel doesn't re-bundle
// NestJS (which requires emitDecoratorMetadata, incompatible with esbuild).
module.exports = require('../dist/serverless').default;
