import React, { useState } from 'react'
import { View, Text, TouchableOpacity, ScrollView, StyleSheet, LayoutAnimation } from 'react-native'

const FAQS = [
  {
    q: 'Are my messages really private?',
    a: 'Yes. Every message is end-to-end encrypted using NaCl box encryption before it leaves your device. The server only ever sees ciphertext — it cannot read your messages.',
  },
  {
    q: 'What happens if I reinstall the app?',
    a: 'Your account is safe — log back in with your username and password. New encryption keys are generated automatically so messages from before the reinstall may show as unreadable (this is by design for forward secrecy).',
  },
  {
    q: 'How do saved files work?',
    a: 'When you receive a photo, video or file you can request to save it. The sender chooses how long you can keep it (1 hour, 5 hours, 24 hours or no limit). Files are stored locally on your device and automatically removed when they expire.',
  },
  {
    q: 'Can I extend the time on a saved file?',
    a: 'Yes — open your Library, tap the file, and press "+ More time". The sender will get a notification and can approve or deny your extension request.',
  },
  {
    q: 'What does blocking someone do?',
    a: "When you block someone they cannot send you messages. They won't be notified they've been blocked. You can block from the ⋮ menu next to any conversation.",
  },
  {
    q: 'How do I delete a chat?',
    a: 'Tap ⋮ next to the conversation and choose Delete Chat. This removes all messages on both the server and your device. The conversation can be restarted at any time.',
  },
  {
    q: 'Can the sender delete a message after sending?',
    a: 'Yes. Long-press or swipe left on any message you sent to delete it. It is removed from the server immediately.',
  },
  {
    q: 'What is the Library?',
    a: 'The Library stores files the sender has permitted you to keep. Tap the feather icon on the Chats screen to see all saves, or tap the feather icon inside a chat to see only saves from that person.',
  },
  {
    q: 'How do voice notes work?',
    a: 'Tap and hold the microphone icon in the chat input bar to record. Release to send. Voice notes are encrypted the same way as text messages.',
  },
  {
    q: 'I forgot my password — what do I do?',
    a: 'There is no password reset because Blink has no access to your account. You will need to sign out and create a new profile. This is intentional — it prevents anyone (including us) from accessing your messages.',
  },
  {
    q: 'Can I change my username?',
    a: 'Yes — go to Profile and update your username. Other users will need to search for your new name to start new chats.',
  },
  {
    q: 'Is my data stored on a server?',
    a: 'Messages are stored temporarily on the server until delivered, then deleted. The server never has the decryption keys. Profile data (username, public key, avatar) is stored so others can find and message you.',
  },
]

function FAQItem({ item }) {
  const [open, setOpen] = useState(false)
  return (
    <TouchableOpacity
      style={styles.item}
      onPress={() => {
        LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut)
        setOpen(o => !o)
      }}
      activeOpacity={0.8}
    >
      <View style={styles.itemHeader}>
        <Text style={styles.question}>{item.q}</Text>
        <Text style={styles.chevron}>{open ? '▲' : '▼'}</Text>
      </View>
      {open && <Text style={styles.answer}>{item.a}</Text>}
    </TouchableOpacity>
  )
}

export default function FAQScreen({ navigation }) {
  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.goBack()}>
          <Text style={styles.back}>← Back</Text>
        </TouchableOpacity>
        <Text style={styles.title}>FAQ</Text>
        <View style={{ width: 60 }} />
      </View>
      <ScrollView contentContainerStyle={styles.list}>
        <Text style={styles.subtitle}>Frequently Asked Questions</Text>
        {FAQS.map((faq, i) => <FAQItem key={i} item={faq} />)}
      </ScrollView>
    </View>
  )
}

const styles = StyleSheet.create({
  container:  { flex: 1, backgroundColor: '#0a0a0a' },
  header:     { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingVertical: 14, borderBottomWidth: 1, borderBottomColor: '#1f1f1f' },
  back:       { color: '#4f6ef7', fontSize: 16 },
  title:      { color: '#fff', fontSize: 17, fontWeight: '700' },
  list:       { padding: 16, paddingBottom: 40 },
  subtitle:   { color: '#555', fontSize: 13, marginBottom: 16, textAlign: 'center' },
  item:       { backgroundColor: '#111', borderRadius: 12, marginBottom: 10, padding: 16 },
  itemHeader: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12 },
  question:   { color: '#fff', fontSize: 15, fontWeight: '600', flex: 1, lineHeight: 21 },
  chevron:    { color: '#555', fontSize: 11, marginTop: 3 },
  answer:     { color: '#aaa', fontSize: 14, lineHeight: 21, marginTop: 12 },
})
