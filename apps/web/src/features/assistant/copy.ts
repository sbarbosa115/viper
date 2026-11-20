/** Customer-facing strings of the assistant feature (welcome chat). */
export const copy = {
  title: 'Welcome chat',
  threadLabel: 'Conversation',
  you: 'You',
  assistant: 'Llyner',
  typing: 'Llyner is typing…',
  inputLabel: 'Your answer',
  send: 'Send',
  failed: "I couldn't reply just now",
  retry: 'Retry',
  limit:
    "You've reached today's message limit. Come back tomorrow, or fill in your profile by hand.",
  loadFailed: 'We could not load the chat. Try again.',
  panelTitle: 'Business Profile',
  panelProgress: '{done} of {total}',
  panelBusiness: 'Business',
  panelProducts: 'Products',
  panelLocation: 'Location',
  panelRadius: 'Delivery radius',
  panelCustomers: 'Current customers',
  panelPrice: 'Price range',
  optional: 'optional',
  miles: 'miles',
  editProfile: 'Edit profile',
} as const;

export const fill = (text: string, vars: Record<string, string | number>) =>
  text.replace(/\{(\w+)\}/g, (m, k: string) => (k in vars ? String(vars[k]) : m));
