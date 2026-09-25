# AI Hiring Workbench | 新兴岗位招聘复核工作台

新兴岗位招聘标准制定与漏筛复核工作台。  
*Emerging role hiring standard formulation & screening omission review workbench.*

---

## 技术栈 / Tech Stack

* **Backend:** Fastify (Node.js) + TypeScript + Zod
* **AI Engine:** DeepSeek (V3 & R1)
* **Database:** PostgreSQL (Supabase)
* **Frontend:** Vite + React (TypeScript) + Tailwind CSS

---

## 目录结构 / Repository Structure

```text
.
├── backend/        # 后端 API、业务服务与评测引擎 / Backend API & eval runner
├── design/         # UI/UX 原型与设计思考规范 / UI/UX design specs & prototype
├── docs/           # 接口规范与技术集成文档 / Documentation & API contracts
├── eval report/    # 基准评测报告与指标总结 / Benchmark evaluation reports
├── frontend/       # 前端客户端应用 (即将推出) / Frontend client (coming soon)
└── README.md       # 项目说明文档 / Project overview
```

---

## 快速开始 / Quick Start

### 1. 后端配置与运行 / Backend Setup
```bash
cd backend
npm install
cp .env.example .env.local
npm run build
npm run dev
```
服务默认运行在 / Server runs on: `http://127.0.0.1:3000`

### 2. 运行基准评测 / Run Benchmark Evaluation
```bash
cd backend
npm run eval        # 离线确定性评测 (无需 API Key) / Offline deterministic run
npm run eval:live   # 联网调用 DeepSeek (需要配置 API Key) / Live DeepSeek run
```
评测报告将自动输出至 / Evaluation reports are exported directly to: `eval report/`

### 3. 前端 / Frontend
前端客户端目前正在积极开发中，测试界面即将推出。  
*Frontend application is under active development and will be available for testing soon.*
