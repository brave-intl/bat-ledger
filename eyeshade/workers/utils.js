module.exports = {
  eachMessage
}

async function eachMessage (runtime, decoder, messages, fn) {
  for (let i = 0; i < messages.length; i += 1) {
    const msg = messages[i]
    const buf = Buffer.from(msg.value, 'binary')
    let message
    try {
      ;({ message } = decoder.decode(buf))
    } catch (e) {
      // If the event is not well formed, capture the error and continue
      runtime.captureException(e, { extra: { topic: decoder.topic, message } })
      continue
    }
    await fn(message)
  }
}
