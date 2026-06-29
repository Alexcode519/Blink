import React, { useState } from 'react'
import {
  View, Text, TextInput, TouchableOpacity, StyleSheet,
  Alert, ScrollView, ActivityIndicator,
} from 'react-native'
import { api } from '../api/client'

const CATEGORIES = [
  { key: 'bug',     label: '🐛  Report a Bug',       hint: 'Something is broken or not working as expected' },
  { key: 'feature', label: '💡  Feature Request',     hint: 'Suggest something new or an improvement' },
  { key: 'general', label: '💬  General Feedback',    hint: 'Anything else on your mind' },
]

export default function FeedbackScreen({ navigation }) {
  const [category, setCategory] = useState(null)
  const [message, setMessage] = useState('')
  const [loading, setLoading] = useState(false)

  async function submit() {
    if (!category) { Alert.alert('Select a category', 'Please choose what type of feedback this is.'); return }
    if (message.trim().length < 10) { Alert.alert('Too short', 'Please write at least 10 characters.'); return }
    setLoading(true)
    try {
      await api.post('/feedback', { category, message: message.trim() })
      Alert.alert('Thank you!', 'Your feedback has been received. We really appreciate it.', [
        { text: 'Done', onPress: () => navigation.goBack() },
      ])
    } catch (err) {
      Alert.alert('Error', err.message)
    } finally {
      setLoading(false)
    }
  }

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.goBack()}>
          <Text style={styles.back}>← Back</Text>
        </TouchableOpacity>
        <Text style={styles.title}>Feedback</Text>
        <View style={{ width: 60 }} />
      </View>

      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        <Text style={styles.intro}>
          Help us improve Blink — every piece of feedback is read and considered.
        </Text>

        <Text style={styles.label}>What kind of feedback?</Text>
        {CATEGORIES.map(cat => (
          <TouchableOpacity
            key={cat.key}
            style={[styles.catBtn, category === cat.key && styles.catBtnActive]}
            onPress={() => setCategory(cat.key)}
          >
            <Text style={[styles.catLabel, category === cat.key && styles.catLabelActive]}>{cat.label}</Text>
            <Text style={styles.catHint}>{cat.hint}</Text>
          </TouchableOpacity>
        ))}

        <Text style={[styles.label, { marginTop: 24 }]}>Your message</Text>
        <TextInput
          style={styles.input}
          value={message}
          onChangeText={setMessage}
          placeholder="Describe the issue or idea in as much detail as possible…"
          placeholderTextColor="#444"
          multiline
          numberOfLines={6}
          textAlignVertical="top"
          maxLength={2000}
        />
        <Text style={styles.charCount}>{message.length} / 2000</Text>

        <TouchableOpacity
          style={[styles.submitBtn, (!category || message.trim().length < 10) && styles.submitDisabled]}
          onPress={submit}
          disabled={loading || !category || message.trim().length < 10}
        >
          {loading
            ? <ActivityIndicator color="#fff" />
            : <Text style={styles.submitText}>Send Feedback</Text>
          }
        </TouchableOpacity>
      </ScrollView>
    </View>
  )
}

const styles = StyleSheet.create({
  container:      { flex: 1, backgroundColor: '#0a0a0a' },
  header:         { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingVertical: 14, borderBottomWidth: 1, borderBottomColor: '#1f1f1f' },
  back:           { color: '#4f6ef7', fontSize: 16 },
  title:          { color: '#fff', fontSize: 17, fontWeight: '700' },
  content:        { padding: 20, paddingBottom: 60 },
  intro:          { color: '#666', fontSize: 14, lineHeight: 21, marginBottom: 28 },
  label:          { color: '#888', fontSize: 12, fontWeight: '600', letterSpacing: 1, textTransform: 'uppercase', marginBottom: 12 },
  catBtn:         { backgroundColor: '#111', borderRadius: 12, padding: 14, marginBottom: 10, borderWidth: 1, borderColor: '#222' },
  catBtnActive:   { borderColor: '#4f6ef7', backgroundColor: '#0d1a3a' },
  catLabel:       { color: '#ccc', fontSize: 15, fontWeight: '600', marginBottom: 3 },
  catLabelActive: { color: '#fff' },
  catHint:        { color: '#555', fontSize: 13 },
  input:          { backgroundColor: '#111', color: '#fff', borderRadius: 12, padding: 14, fontSize: 15, minHeight: 130, borderWidth: 1, borderColor: '#222' },
  charCount:      { color: '#333', fontSize: 12, textAlign: 'right', marginTop: 6, marginBottom: 24 },
  submitBtn:      { backgroundColor: '#4f6ef7', borderRadius: 12, padding: 16, alignItems: 'center' },
  submitDisabled: { backgroundColor: '#1a2a4a', opacity: 0.5 },
  submitText:     { color: '#fff', fontWeight: '700', fontSize: 16 },
})
