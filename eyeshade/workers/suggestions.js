module.exports = (runtime) => {
  runtime.kafka.on('grant-suggestion', async (messages) => {
    console.log(messages)
  })
}
