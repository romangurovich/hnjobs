import { Client } from '@temporalio/client';

// Create a singleton Temporal client
export const temporalClient = new Client();
