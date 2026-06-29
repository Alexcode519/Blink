let activeChatUsername = null

export function setActiveChat(username) {
  activeChatUsername = username
}

export function clearActiveChat() {
  activeChatUsername = null
}

export function getActiveChat() {
  return activeChatUsername
}
