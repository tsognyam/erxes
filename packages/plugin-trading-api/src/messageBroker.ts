import { init as initBrokerCore } from '@erxes/api-utils/src/messageBroker';
let client;
export const initBroker = async options => {
  client = await initBrokerCore(options);
  const { consumeQueue, consumeRPCQueue } = client;
};

export default function() {
  return client;
}
