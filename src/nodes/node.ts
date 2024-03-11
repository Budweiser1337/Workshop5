import bodyParser from "body-parser";
import express from "express";
import { BASE_NODE_PORT } from "../config";
import { Value } from "../types";

type NodeState = {
  killed: boolean; // this is used to know if the node was stopped by the /stop route. It's important for the unit tests but not very relevant for the Ben-Or implementation
  x: 0 | 1 | "?" | null; // the current consensus value
  decided: boolean | null; // used to know if the node reached finality
  k: number | null; // current step of the node
};

export async function node(
  nodeId: number, // the ID of the node
  N: number, // total number of nodes in the network
  F: number, // number of faulty nodes in the network
  initialValue: Value, // initial value of the node
  isFaulty: boolean, // true if the node is faulty, false otherwise
  nodesAreReady: () => boolean, // used to know if all nodes are ready to receive requests
  setNodeIsReady: (index: number) => void // this should be called when the node is started and ready to receive requests
) {
  const initialState: NodeState = {
    killed: false,
    x: isFaulty ? null : initialValue,
    decided: isFaulty ? null : false,
    k: isFaulty ? null : 0,
  };

  const node = express();
  node.use(express.json());
  node.use(bodyParser.json());

  const state: NodeState = { ...initialState };
  const allNodeIds = Array.from({ length: N }, (_, index) => index);
  const getNodeEndpoint = (nodeId: number) => `http://localhost:${BASE_NODE_PORT + nodeId}/message`;
  const receivedMessages: Value[] = [];

  function getMajorityValue(values: Value[]): Value {
    // Filter out undefined values from the input array
    const filteredValues = values.filter(value => value !== undefined);
  
    if (filteredValues.length === 0) {
      // Handle the case where all values are undefined
      throw new Error('All values are undefined');
    }
  
    const counts = filteredValues.reduce((acc, value) => {
      acc[value] = (acc[value] || 0) + 1;
      return acc;
    }, {} as Record<Value, number>);
  
    const majorityValue = Object.keys(counts).reduce((a, b) =>
      counts[a as Value]! > counts[b as Value]! ? a : b as Value,
      filteredValues[0]
    );
  
    return majorityValue as Value;
  }

  function broadcastDecision(decision: Value): void {
    if (!state.killed) {
      allNodeIds.forEach((nodeId) => sendDecisionToNode(nodeId, decision));
    } else {
      console.log("Node is killed. Cannot broadcast decision.");
    }
  }

  async function sendDecisionToNode(nodeId: number, decision: Value | undefined): Promise<void> {
    const endpoint = getNodeEndpoint(nodeId);
  
    try {
      if (decision === undefined) {
        throw new Error('Decision is undefined');
      }
  
      let decisionValue: string;
  
      if (typeof decision === 'object' && 'value' in decision) {
        decisionValue = (decision as { value: string }).value;
      } else {
        decisionValue = String(decision);
      }
  
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ value: decisionValue }),
      });
  
      if (!response.ok) {
        throw new Error(`Received non-ok response: ${response.status} ${response.statusText}`);
      }
  
      console.log(`Decision ${decisionValue} sent to Node ${nodeId}`);
    } catch (error: any) {
      console.error(`Error sending decision to Node ${nodeId}:`, error.message);
    }
  }

  // TODO implement this
  // this route allows retrieving the current status of the node
  node.get("/status", (req, res) => {
    if (isFaulty) {
      res.status(500).send("faulty");
    } else {
      res.status(200).send("live");
    }
  });

  // TODO implement this
  // this route allows the node to receive messages from other nodes
  node.post("/message", (req, res) => {
    const message = req.body;
  
    if (!state.killed) {
      if (message && message.value !== undefined) { // Check if the message and its value are defined
        receivedMessages.push(message.value);
  
        // Check if enough messages received for phase 1
        if (receivedMessages.length > N / 2) {
          if (state.k !== null && state.k % 2 === 0) {
            const majorityValue = getMajorityValue(receivedMessages);
            state.x = majorityValue;
            broadcastDecision(majorityValue);
          }
  
          receivedMessages.length = 0;
          res.status(200).send("Phase 1 completed");
        } else {
          res.status(200).send("Message received");
        }
      } else {
        res.status(400).send("Invalid message format");
      }
    } else {
      res.status(500).send("Node is killed");
    }
  });

  // TODO implement this
  // this route is used to start the consensus algorithm
  node.get("/start", async (req, res) => {
    if (!nodesAreReady()) {
      res.status(500).send("Nodes are not ready yet");
      return;
    }

    if (!state.killed) {
      if (state.k !== null && state.k === 0) {
        broadcastDecision(initialValue);
      }

      if (state.k !== null && state.k % 2 === 0) {
        const majorityValue = getMajorityValue(receivedMessages);
        state.x = majorityValue;
        broadcastDecision(majorityValue);
      }

      if (state.k !== null && state.k % 2 === 1) {
        if (state.x !== null && state.x !== "?") {
          state.decided = true;
        }
      }
      if (state.k !== null) {
        state.k++;
      }

      res.status(200).send("Consensus algorithm started");
    } else {
      res.status(500).send("Node is killed");
    }
  });

  // TODO implement this
  // this route is used to stop the consensus algorithm
  node.get("/stop", async (req, res) => {
    state.killed = true;
    res.status(200).send("Consensus algorithm stopped");
  });

  // TODO implement this
  // get the current state of a node
  node.get("/getState", (req, res) => {
    res.json(initialState);
  });

  // start the server
  const server = node.listen(BASE_NODE_PORT + nodeId, async () => {
    console.log(
      `Node ${nodeId} is listening on port ${BASE_NODE_PORT + nodeId}`
    );

    // the node is ready
    setNodeIsReady(nodeId);
  });

  return server;
}
