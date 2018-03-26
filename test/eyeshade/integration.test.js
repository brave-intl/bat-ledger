// get information that a payment occurred
// user voted for various publishers (redis)
// pulling a report for publishers / surveyors
// check math
import dotenv from 'dotenv';
import BigNumber from 'bignumber.js';
import UpholdSDK from '@uphold/uphold-sdk-javascript';
import anonize from 'node-anonize2-relic';
import crypto from 'crypto';
import request from 'supertest';
import test from 'ava';
import tweetnacl from 'tweetnacl';
import uuid from 'uuid';
import { sign } from 'http-request-signature';

test('eyeshade: ', async t => {
  const listener = process.env.BAT_EYESHADE_SERVER || 'https://eyeshade-staging.mercury.basicattentiontoken.org';
  const srv = {
    listener,
  };
  let response = null;
  // curl -H "Authorization: Bearer foobarfoobar" http://localhost:3002/v1/reports/surveyors/contributions\?format\=csv\&summary\=false\&excluded\=false
  response = await request(srv.listener).get('/v1/reports/surveyors/contributions').send({
    //
  }).expect(ok)
  // const personaId = uuid.v4().toLowerCase()
  // const viewingId = uuid.v4().toLowerCase()
});