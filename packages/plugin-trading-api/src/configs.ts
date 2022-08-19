import typeDefs from './graphql/typeDefs';
import resolvers from './graphql/resolvers';

import { initBroker } from './messageBroker';
import { PrismaClient } from '@prisma/client';

export let mainDb;
export let debug;
export let graphqlPubsub;
export let serviceDiscovery;
export let prisma;
export default {
  name: 'trading',
  graphql: async sd => {
    serviceDiscovery = sd;

    return {
      typeDefs: await typeDefs(sd),
      resolvers: await resolvers(sd)
    };
  },
  apolloServerContext: async (context, req) => {
    context.subdomain = req.hostname;

    return context;
  },
  onServerInit: async options => {
    mainDb = options.db;
    prisma = new PrismaClient();
    initBroker(options.messageBrokerClient);

    graphqlPubsub = options.pubsubClient;

    debug = options.debug;
  }
};
