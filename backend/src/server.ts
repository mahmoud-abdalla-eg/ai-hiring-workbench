import fastify, { FastifyInstance } from "fastify";
import cors from "@fastify/cors";
import sensible from "@fastify/sensible";
import { config } from "dotenv";
import { MockAdapter } from "./adapters/mock-adapter.js";
import { DeepSeekAdapter } from "./adapters/deepseek-adapter.js";
import { ModelAdapter } from "./adapters/model-adapter.js";
import { StandardRepository } from "./infra/repositories/standard-repo.js";
import { CandidateRepository } from "./infra/repositories/candidate-repo.js";
import { ReviewRepository } from "./infra/repositories/review-repo.js";
import { TaskService } from "./services/task-service.js";
import { StandardService } from "./services/standard-service.js";
import { CandidateService } from "./services/candidate-service.js";
import { StudentService } from "./services/student-service.js";
import { SearchService } from "./services/search-service.js";
import { taskRoutes } from "./routes/task-routes.js";
import { sourceRoutes } from "./routes/source-routes.js";
import { standardRoutes } from "./routes/standard-routes.js";
import { candidateRoutes } from "./routes/candidate-routes.js";
import { studentRoutes } from "./routes/student-routes.js";
import { decisionRoutes } from "./routes/decision-routes.js";
import { RuleViolationError, sanitizeRuleR14_RedactPII } from "./domain/rules.js";

import { existsSync } from "node:fs";

// Load environment variables (.env.local takes priority over .env)
if (existsSync(".env.local")) {
  config({ path: ".env.local" });
} else {
  config();
}

export function buildApp(customAdapter?: ModelAdapter): FastifyInstance {
  const app = fastify({
    logger: {
      level: process.env.LOG_LEVEL || "info",
      serializers: {
        // Enforce Rule R-14: Redact raw PII from logs
        req(request) {
          return {
            method: request.method,
            url: request.url,
            parameters: request.params
          };
        }
      }
    }
  });

  // Plugins
  app.register(sensible);
  app.register(cors, {
    origin: process.env.CORS_ORIGIN || "*",
    methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"]
  });

  // Model Adapter initialization
  const modelProvider = process.env.MODEL_PROVIDER?.trim().toLowerCase() || "mock";
  const modelAdapter: ModelAdapter =
    customAdapter || (modelProvider === "deepseek" ? new DeepSeekAdapter() : new MockAdapter());

  // Repositories
  const standardRepo = new StandardRepository();
  const candidateRepo = new CandidateRepository();
  const reviewRepo = new ReviewRepository();

  // Services
  const taskService = new TaskService(modelAdapter, standardRepo);
  const standardService = new StandardService(modelAdapter, standardRepo);
  const candidateService = new CandidateService(modelAdapter, candidateRepo, standardRepo, reviewRepo);
  const studentService = new StudentService(modelAdapter, standardRepo, reviewRepo);
  const searchService = new SearchService(modelAdapter, standardRepo, candidateRepo);

  // Global Error Handler
  app.setErrorHandler((error, request, reply) => {
    if (error instanceof RuleViolationError) {
      return reply.status(error.statusCode).send({
        error: error.ruleId,
        message: error.message
      });
    }

    if (error.validation) {
      return reply.status(400).send({
        error: "VALIDATION_ERROR",
        message: error.message
      });
    }

    request.log.error(error);
    return reply.status(500).send({
      error: "INTERNAL_SERVER_ERROR",
      message: "An internal server error occurred."
    });
  });

  // Health check
  app.get("/health", async () => ({
    status: "ok",
    modelProvider,
    timestamp: new Date().toISOString()
  }));

  // Mount API v1 Routes
  app.register(taskRoutes, { prefix: "/api/v1", taskService });
  app.register(sourceRoutes, { prefix: "/api/v1", standardService });
  app.register(standardRoutes, { prefix: "/api/v1", standardService, searchService });
  app.register(candidateRoutes, { prefix: "/api/v1", candidateService });
  app.register(studentRoutes, { prefix: "/api/v1", studentService });
  app.register(decisionRoutes, { prefix: "/api/v1", candidateService });

  return app;
}

// Start server if executed directly
if (import.meta.url.startsWith("file:") && process.argv[1] && process.argv[1].endsWith("server.ts")) {
  const port = parseInt(process.env.PORT || "3000", 10);
  const host = process.env.HOST || "127.0.0.1";
  const app = buildApp();

  app.listen({ port, host }, (err, address) => {
    if (err) {
      app.log.error(err);
      process.exit(1);
    }
    console.log(`🚀 Workbench Backend running at ${address}`);
  });
}
