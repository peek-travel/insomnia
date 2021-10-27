FROM node:12-bullseye

ENV REFRESH_DATE 2021-10-27

ENV NODE_PATH /usr/local/lib/node_modules

RUN apt-get update
RUN apt-get install -y \
    python3 \
    python3-pip \
    g++ \
    make \
    git

WORKDIR /app

RUN npm config set unsafe-perm true
RUN npm install -g junit-merge
RUN npm install -g mochawesome-report-generator
RUN npm install -g insomnia-inso

COPY . .


RUN cd packages/insomnia-inso \
    && yarn install

RUN cd packages/insomnia-testing \
    && yarn install \
    && yarn build \
    && rm -rf ../insomnia-inso/node_modules/insomnia-testing/dist \
    && rm -rf ../insomnia-inso/node_modules/insomnia-testing/node_modules \
    && rm -rf $NODE_PATH/insomnia-inso/node_modules/insomnia-testing/dist \
    && rm -rf $NODE_PATH/insomnia-inso/node_modules/insomnia-testing/node_modules \
    && cp -r dist ../insomnia-inso/node_modules/insomnia-testing/ \
    && cp -r node_modules ../insomnia-inso/node_modules/insomnia-testing/ \
    && cp -r dist $NODE_PATH/insomnia-inso/node_modules/insomnia-testing/ \
    && cp -r node_modules $NODE_PATH/insomnia-inso/node_modules/insomnia-testing/


RUN cd packages/insomnia-inso \
    && yarn build

RUN cd packages/insomnia-inso \
    && rm -rf $NODE_PATH/insomnia-inso/dist \
    && cp -r dist $NODE_PATH/insomnia-inso \
    && rm -f $NODE_PATH/insomnia-inso/node_modules/insomnia-plugin-response/index.js \
    && mv index-plugin-response.js.txt $NODE_PATH/insomnia-inso/node_modules/insomnia-plugin-response/index.js

RUN cd packages/insomnia-inso/node_modules \
    && cp -r insomnia-plugin-gql-fragments $NODE_PATH/insomnia-inso/node_modules/ \
    && cd $NODE_PATH/insomnia-inso/node_modules/ \
    && rm -rf insomnia-plugin-core-themes \
    && mv insomnia-plugin-gql-fragments insomnia-plugin-core-themes \
    && cd insomnia-plugin-core-themes \
    && npm install
