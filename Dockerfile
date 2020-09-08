FROM node:12-slim
WORKDIR /usr/src/app
COPY package*.json ./
RUN npm install --only=production
COPY *.js ./
COPY static ./static
COPY views ./views
# echo-sd install
COPY echo-sd ./echo-sd
RUN install -m 0755 echo-sd /usr/local/bin/echo-sd \
  && rm echo-sd \
  && apt-get clean \
  && rm -rf /var/lib/apt/lists/*
CMD [ "npm", "start" ]
