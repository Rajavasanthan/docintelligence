import { serve } from "bun";
import { Readable } from "stream";
import { TextractClient, AnalyzeDocumentCommand } from "@aws-sdk/client-textract";
import {
  ChatPromptTemplate,
  HumanMessagePromptTemplate,
  SystemMessagePromptTemplate,
} from "langchain/prompts";
import { JsonOutputFunctionsParser } from "langchain/output_parsers";
import { ChatOpenAI } from "langchain/chat_models/openai";
enum FeatureType {
  TABLES = "TABLES",
  FORMS = "FORMS",
  QUERIES = "QUERIES",
  SIGNATURES = "SIGNATURES",
  LAYOUT = "LAYOUT",
}


// Set up your OpenAI API key
const openAIApiKey = process.env.OPENAI_API_KEY
// CORS headers
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

// Initialize Textract client
const textractClient = new TextractClient({
  region: "us-east-1", // Your AWS region
  credentials: {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID!,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY!,
  },
});
async function analyzeDocument(fileBuffer: Buffer) {
  // Convert Buffer to ArrayBuffer
  const arrayBuffer = fileBuffer.buffer.slice(fileBuffer.byteOffset, fileBuffer.byteOffset + fileBuffer.length);

  // Use the custom FeatureType enum
  const input = {
    Document: {
      Bytes: arrayBuffer, // Pass ArrayBuffer instead of Buffer
    },
    FeatureTypes: [FeatureType.FORMS, FeatureType.TABLES], // Use custom enum here
  };

  const command = new AnalyzeDocumentCommand(input);

  try {
    // Send the command to AWS Textract
    const response = await textractClient.send(command);
    console.log("Analysis Result:", response);
    return response; // Return response as needed
  } catch (error) {
    console.error("Error processing document:", error);
    throw new Error("Error processing document.");
  }
}

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

        // Convert buffer to readable stream
        const fileStream =Buffer.from(fileBuffer, "base64");
        console.log("Converted fileBuffer to readable stream");

        

        // Handle response
        if (initialResponse?.Blocks) {
          console.log("Textract response:", initialResponse.Blocks);
        } else {
          throw new Error("Failed to analyze document.");
        }

        // Extracted full text
        let fullText = "";
        initialResponse.Blocks?.forEach((block) => {
          if (block.BlockType === "LINE") {
            fullText += block.Text + "\n";
          }
        });
        console.log("Extracted text:", fullText);

        // Create the prompt for the LLM
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

        // Initialize OpenAI LLM
        const llm = new ChatOpenAI({
          modelName: "gpt-3.5-turbo",
          temperature: 0,
          openAIApiKey,
        });

        console.log("ChatOpenAI model created");

        const chain = prompt.pipe(llm).pipe(new JsonOutputFunctionsParser());
        console.log("LLM chain created");

        // Pass the extracted text to the LLM for processing
        const responseLLM = await chain.invoke({
          extractedInformation: fullText,
        });
        console.log("LLM response:", responseLLM);

        // Return the extracted data in the response
        return new Response(JSON.stringify({ extractedData: responseLLM }), {
          headers: { "Content-Type": "application/json", ...corsHeaders },
        });
      } catch (error: any) {
        console.error("Error processing document:", error);
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
