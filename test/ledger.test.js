/* global describe, it */

'use strict'

const server = require('../ledger/server')
const should = require('chai').expect
const request = require('supertest')

describe('server api', function () {
  it('responds with ack.', async function () {
    var srv = await server
    return request(srv.listener).get('/').expect(200).then(response => {
      should(response.text).equal('ack.')
    })
  })
})

describe('persona api', function () {
  it('responds with registrarVK.', async function () {
    var srv = await server
    return request(srv.listener).get('/v1/registrar/persona').expect(200).then(response => {
      should(response.body).to.have.property('registrarVK')
    })
  })
})
