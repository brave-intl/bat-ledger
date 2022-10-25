const test = require('ava')
const { hasValidCountry } = require('./publishers.js')
const sinon = require("sinon");
const { Runtime } = require('bat-utils')
const config = require('../../config')
const tRuntime = new Runtime(config)


test('should return true if Exception', async (t) => {
  const stubPost = sinon.stub().throws();
  const val = await hasValidCountry(tRuntime, 'abc', stubPost)
  t.deepEqual(val, true, `Should return true if trying to make http calls blows up`)
})

test('should return false if the http ret value is false', async (t) => {
  const stubPost = sinon.stub().returns(JSON.stringify({'abc': false}));
  const val = await hasValidCountry(tRuntime, 'abc', stubPost)
  t.deepEqual(val, false, `Should return false if creators does`)
})

test('should return true if the http ret value is true', async (t) => {
  const stubPost = sinon.stub().returns(JSON.stringify({'abc': true}));
  const val = await hasValidCountry(tRuntime, 'abc', stubPost)
  t.deepEqual(val, true, `Should return true if creators does`)
})
