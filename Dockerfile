FROM node:8-onbuild
# Create a default config file, can be overridden via volume mount
RUN cp /usr/src/app/config/config.development.js.tpl /usr/src/app/config/config.development.js
EXPOSE 3002
