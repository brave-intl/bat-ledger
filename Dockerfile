FROM node:14.15-alpine

RUN apk add yarn python g++ make postgresql postgresql-contrib

RUN rm -rf /var/cache/apk/*

RUN mkdir -p /usr/src/app
RUN mkdir /usr/src/app/bat-utils
WORKDIR /usr/src/app

COPY package*.json ./
RUN yarn install

COPY . /usr/src/app

CMD yarn start-eyeshade-web
