FROM node:16.20.1

RUN apt-get update && apt-get install -y postgresql-client

RUN mkdir -p /usr/src/app && mkdir /usr/src/app/bat-utils
WORKDIR /usr/src/app

RUN npm install -g npm@8.15.1

COPY package.json /usr/src/app/
COPY bat-utils/package.json /usr/src/app/bat-utils/
RUN npm install
COPY . /usr/src/app

CMD npm run eyeshade-consumer
