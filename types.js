// v2.0.0: empty types module preserved for the published `./types` export.
// Pre-v2 the source lived in mcp/dist/types.js (also empty). External
// consumers who imported from @danielblomma/cortex-mcp/types continue
// to resolve, even though there are no runtime exports.
export {};
