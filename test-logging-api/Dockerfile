FROM node:8.11-alpine
MAINTAINER Nobuyuki Matsui <nobuyuki.matsui@gmail.com>

RUN apk --no-cache add tini
ENTRYPOINT ["/sbin/tini", "--"]

WORKDIR /opt
ENV NODE_PATH /opt
COPY . /opt
RUN npm install

EXPOSE 3030
CMD ["node", "/opt/app.js"]
