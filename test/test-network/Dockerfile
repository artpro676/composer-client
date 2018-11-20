#FROM ubuntu:16.04
FROM node:jessie

RUN mkdir /usr/src/sample-network

WORKDIR  /usr/src/sample-network

COPY . /usr/src/sample-network

RUN npm i -g node-gyp --unsafe-perm
RUN npm i -g grpc
RUN npm install -g composer-cli@0.20
RUN npm install -g composer-rest-server@0.20
RUN npm install -g generator-hyperledger-composer@0.20
RUN npm install -g composer-playground@0.20


EXPOSE 8080

CMD ["sh", "./startNetwork"]
