// Single source of truth for product/assistant display names.
// Never hardcode these names elsewhere (routes, table names, bundle ids, etc).
export const branding = {
  appName: process.env.APP_NAME ?? "Working Title",
  assistantName: process.env.ASSISTANT_NAME ?? "Assistant",
};
