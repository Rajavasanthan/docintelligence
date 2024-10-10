import { serve } from "bun";
import { Readable } from "stream";
import DocumentIntelligence, {
  getLongRunningPoller,
  isUnexpected,
} from "@azure-rest/ai-document-intelligence";
import {
  ChatPromptTemplate,
  HumanMessagePromptTemplate,
  SystemMessagePromptTemplate,
} from "langchain/prompts";
import { JsonOutputFunctionsParser } from "langchain/output_parsers";
import { ChatOpenAI } from "langchain/chat_models/openai";

const azureEndpoint = process.env.AZURE_ENDPOINT || "null";
const azureKey = process.env.AZURE_KEY || "12334";
const openAIApiKey = process.env.OPENAI_API_KEY;

// CORS headers
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

serve({
  port: 4000,
  async fetch(req: Request) {
    // Handle CORS preflight request (OPTIONS)
    if (req.method === "OPTIONS") {
      return new Response(null, {
        headers: corsHeaders,
        status: 204,
      });
    }

    if (req.method === "POST") {
      try {
        console.log("Received a POST request");

        const { fileBuffer, filePath } = await req.json();
        console.log("Received fileBuffer and filePath:", filePath);

        if (!fileBuffer || !filePath) {
          console.error("Missing file or file path");
          return new Response(
            JSON.stringify({ error: "Missing file or file path" }),
            { status: 400, headers: corsHeaders }
          );
        }

        const fileExtension = filePath.split(".").pop()?.toLowerCase();
        console.log("File extension:", fileExtension);

        const contentType =
          fileExtension === "jpg" || fileExtension === "jpeg"
            ? "image/jpeg"
            : "application/pdf";
        console.log("Content type:", contentType);

        const client = DocumentIntelligence(azureEndpoint, { key: azureKey });
        console.log("Created Azure DocumentIntelligence client");

        // Convert buffer to readable stream
        const fileStream = Readable.from(Buffer.from(fileBuffer, "base64"));
        console.log("Converted fileBuffer to readable stream");

        // Make Azure request
        console.log("Sending request to Azure DocumentIntelligence...");
        const initialResponse = await client
          .path("/documentModels/{modelId}:analyze", "prebuilt-layout")
          .post({
            contentType,
            body: fileStream,
            queryParameters: {
              outputContentFormat: "markdown",
            },
          });

        // Handle response
        if (isUnexpected(initialResponse)) {
          throw new Error(
            initialResponse.body?.error?.message || "Unexpected response"
          );
        }

        let response: any;
        try {
          const poller = await getLongRunningPoller(client, initialResponse);
          console.log("Waiting for the poller to finish...");
          response = (await poller.pollUntilDone()).body;
        } catch (pollerError) {
          console.error("Error with polling:", pollerError);
          throw new Error("Polling operation failed.");
        }

        let fullText = "";
        if (response.analyzeResult && response.analyzeResult.content) {
          fullText = response.analyzeResult.content;
        }
        console.log("Extracted text:", fullText);

        const prompt = new ChatPromptTemplate({
          promptMessages: [
            SystemMessagePromptTemplate.fromTemplate(
              "Extract data as key value pairs according to their appropriate titles. "
            ),
            HumanMessagePromptTemplate.fromTemplate("{extractedInformation}"),
          ],
          inputVariables: ["extractedInformation"],
        });

        console.log("ChatPromptTemplate created");

        const llm = new ChatOpenAI({
          modelName: "gpt-3.5-turbo",
          temperature: 0,
          openAIApiKey,
        });

        console.log("ChatOpenAI model created");

        const chain = prompt.pipe(llm);
        console.log("LLM chain created");

        const responseLLM = await chain.invoke({
          extractedInformation: fullText,
        });
        console.log("LLM response structure:", JSON.stringify(responseLLM, null, 2));

        // Return the extracted data in the response
        return new Response(JSON.stringify({ extractedData: responseLLM}), {
          headers: { "Content-Type": "application/json", ...corsHeaders },
        });
      } catch (error: any) {
        console.error("Error in workspace rental:", error);
        return new Response(
          JSON.stringify({
            error: "Internal Server Error",
            details: error.message,
          }),
          { status: 500, headers: corsHeaders }
        );
      }
    }

    return new Response(JSON.stringify({ error: "Invalid request method" }), {
      status: 405,
      headers: corsHeaders,
    });
  },
});
