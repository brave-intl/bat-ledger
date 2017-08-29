FROM node:8

RUN mkdir -p /usr/src/app && mkdir /usr/src/app/bat-utils
WORKDIR /usr/src/app

COPY package.json /usr/src/app/
COPY bat-utils/package.json /usr/src/app/bat-utils/
RUN npm install
COPY . /usr/src/app

# Create a default config file, can be overridden via volume mount
RUN cp /usr/src/app/config/config.development.js.tpl /usr/src/app/config/config.development.js
EXPOSE 3002
