#!/usr/bin/env node

const execa = require('execa')

const findContainerId = node => {
  const cmd = `
    docker ps \
      --filter "status=running" \
      --filter "label=custom.project=kafkajs" \
      --filter "label=custom.service=${node}" \
      --no-trunc \
      -q
  `
  const containerId = execa.commandSync(cmd, { shell: true }).stdout.toString('utf-8')
  console.log(`${node}: ${containerId}`)
  return containerId
}

const waitForNode = containerId => {
  const cmd = `
    docker exec \
      ${containerId} \
      bash -c "JMX_PORT=9998 kafka-topics --zookeeper zookeeper:2181 --list 2> /dev/null"
    sleep 5
  `
  return execa.command(cmd, { shell: true })
    .then(() => console.log(`Kafka container ${containerId} is running`))
}

console.log('\nFinding container ids...')
const kafka1ContainerId = findContainerId('kafka1')
const kafka2ContainerId = findContainerId('kafka2')
const kafka3ContainerId = findContainerId('kafka3')

console.log('\nWaiting for nodes...')

Promise.all([
  waitForNode(kafka1ContainerId),
  waitForNode(kafka2ContainerId),
  waitForNode(kafka3ContainerId)
]).then(() => {
  console.log('\nAll nodes up:')
  console.log(
    execa
      .commandSync('docker-compose -f docker-compose.yml ps', { shell: true })
      .stdout.toString('utf-8')
  )
})
