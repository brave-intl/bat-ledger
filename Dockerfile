FROM node:14.15

RUN mkdir -p /usr/src/app \
  && apt-get update && apt-get install -y build-essential python librdkafka-dev libsasl2-dev libsasl2-modules openssl postgresql postgresql-contrib \
  && apt-get autoremove -y && apt-get autoclean -y \
  && rm -rf /var/lib/apt/lists/*

RUN mkdir -p /usr/src/app
RUN mkdir /usr/src/app/bat-utils
WORKDIR /usr/src/app
COPY package.json ./
COPY yarn.lock ./
RUN yarn
COPY . /usr/src/app

CMD yarn start-eyeshade-web
