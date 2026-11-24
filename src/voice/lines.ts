/** Every line the voice says in its own words, word for word. */
export const LINES = {
  lost: "I've lost the agent.",
  back: "The agent is back.",
  restarting: "The agent is restarting.",
  cantStart: "The agent can't start.",
  notConnected: "The agent isn't connected.",
  newConversation: "Starting a new conversation.",
  needApproval: "I need your approval on your phone.",
  approveOnPhone: "Please approve that on your phone.",
  nothingWaiting: "There's nothing waiting for approval.",
  approved: "Approved.",
  denied: "Denied.",
  timedOut: "That approval timed out.",
  turnFailed: "That didn't go through. It's on your screen.",
} as const;

export type Line = (typeof LINES)[keyof typeof LINES];
