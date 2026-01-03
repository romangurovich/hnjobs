import { Client } from '@temporalio/client';

let temporalClient: Client | undefined;

function getTemporalClient(): Client {
  if (!temporalClient) {
    // In a real application, you'd want to configure this properly
    temporalClient = new Client();
  }
  return temporalClient;
}

export { getTemporalClient };
