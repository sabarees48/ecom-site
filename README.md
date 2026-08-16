# EKS + GitHub Actions + CloudFormation Demo (Multi-Service AWS Architecture)

A CloudMart-style demo app: a login-gated frontend on S3, 5 containerized
microservices on EKS, plus event-driven serverless pieces — built to show
students how these AWS services fit together in one working system.

## AWS services used

| Service | Role in this demo |
|---|---|
| **VPC** | Network foundation — public/private subnets, NAT gateway |
| **EKS** | Runs the 5 containerized microservices |
| **ECR** | Stores the 5 Docker images |
| **EC2** | Managed node group workers (EKS) + a bastion host for RDS access |
| **RDS (PostgreSQL)** | Persistent store for `order-service` |
| **DynamoDB** | Catalog store for `product-service`, plus an order-event log |
| **EventBridge** | `order-service` publishes `OrderPlaced`; a rule routes it to Lambda |
| **Lambda** | `ProcessOrder` (event-driven) and `Analytics` (API Gateway-driven) |
| **SNS** | Order notifications — published by the Lambda and by `notification-service` |
| **API Gateway** | Fronts the `Analytics` Lambda as a serverless HTTP endpoint |
| **CloudWatch** | Dashboard + alarms (RDS CPU, Lambda errors) wired to SNS |
| **S3** | Static hosting for the frontend |
| **IAM (OIDC/IRSA)** | GitHub Actions and pods both use short-lived, scoped roles — no static AWS keys anywhere |

## Architecture

```
GitHub Actions (OIDC role) ──> CloudFormation ──> all AWS resources below

Browser
  └─> S3 static site (login screen -> dashboard)
        ├─> ALB (EKS Ingress)
        │     ├─ /api/users         -> user-service        (in-memory)
        │     ├─ /api/products      -> product-service      -> DynamoDB (Products table)
        │     ├─ /api/orders        -> order-service         -> RDS Postgres
        │     │                          └─ POST also publishes "OrderPlaced" -> EventBridge
        │     ├─ /api/payments      -> payment-service       (in-memory)
        │     └─ /api/notifications -> notification-service  -> SNS (manual publish)
        │
        └─> API Gateway /summary -> Analytics Lambda -> scans DynamoDB tables

EventBridge rule (OrderPlaced) -> ProcessOrder Lambda -> DynamoDB (OrderEvents) + SNS

Bastion EC2 (SSM Session Manager only) -> RDS, for manual DB inspection
CloudWatch Dashboard + Alarms (RDS CPU, Lambda errors) -> SNS
```

Pods reach AWS services using **IRSA** (IAM Roles for Service Accounts) —
each of `order-service`, `product-service`, and `notification-service` runs
under its own Kubernetes ServiceAccount, annotated with a narrowly-scoped IAM
role. No AWS access keys are ever baked into an image or stored in a Secret.

## Repository layout

```
eks-demo/
├── infrastructure/                 CloudFormation, deploy in numeric order
│   ├── 00-github-oidc-role.yaml     bootstrap: GitHub Actions OIDC role (run once, locally)
│   ├── 01-vpc.yaml
│   ├── 02-eks-cluster.yaml
│   ├── 03-ecr-repos.yaml
│   ├── 04-s3-frontend.yaml
│   ├── 05-rds.yaml                  PostgreSQL for order-service
│   ├── 06-dynamodb.yaml             Products + OrderEvents tables
│   ├── 07-sns-eventbridge.yaml      SNS topic + custom EventBridge bus
│   ├── 08-lambda-functions.yaml     ProcessOrder + Analytics Lambdas
│   ├── 09-api-gateway.yaml          HTTP API fronting Analytics Lambda
│   ├── 10-ec2-bastion.yaml          SSM-only bastion for RDS access
│   ├── 11-irsa-roles.yaml           EKS OIDC provider + pod IAM roles
│   └── 12-cloudwatch.yaml           Dashboard + alarms
├── services/                       5 Node.js/Express microservices
│   ├── user-service/                in-memory mock data
│   ├── product-service/             DynamoDB (falls back to mock if unconfigured)
│   ├── order-service/               RDS Postgres + EventBridge (same fallback)
│   ├── payment-service/             in-memory mock data
│   └── notification-service/        SNS publish (same fallback)
│       ├── index.js, package.json, Dockerfile
│       └── k8s/deployment.yaml, k8s/service.yaml
├── k8s/
│   ├── namespace.yaml
│   ├── service-accounts.yaml        IRSA ServiceAccounts (3)
│   └── ingress.yaml                 ALB ingress routing all 5 services
├── frontend/                       Login screen + dashboard SPA, deployed to S3
│   ├── index.html, app.js, style.css
└── .github/workflows/
    ├── deploy-infra.yml             Provisions everything via CloudFormation, in order
    ├── deploy-services.yml          Builds/pushes images, deploys to EKS
    └── deploy-frontend.yml          Syncs frontend/ to S3
```

## Prerequisites

- AWS account with permission to create the resources listed above
- AWS CLI and `kubectl` installed locally (bootstrap + troubleshooting)
- A GitHub repository containing this project
- `eksctl` and Terraform are **not** used — everything is CloudFormation

## One-time setup

### 1. Bootstrap the GitHub OIDC role (run locally, once)

```bash
aws cloudformation deploy \
  --template-file infrastructure/00-github-oidc-role.yaml \
  --stack-name eks-demo-github-oidc \
  --parameter-overrides GitHubOrg=<your-org> GitHubRepo=<your-repo> \
  --capabilities CAPABILITY_NAMED_IAM

aws cloudformation describe-stacks \
  --stack-name eks-demo-github-oidc \
  --query "Stacks[0].Outputs[0].OutputValue" --output text
```

### 2. Add GitHub repository secrets

| Secret | Value |
|---|---|
| `AWS_ROLE_ARN` | ARN from step 1 |
| `AWS_ACCOUNT_ID` | your 12-digit AWS account ID |
| `FRONTEND_BUCKET_NAME` | S3 bucket name you'll use (must be globally unique) |

### 3. Run the infrastructure workflow

GitHub → **Actions → Deploy Infrastructure (CloudFormation) → Run workflow**,
supplying `frontend_bucket_name` and (optionally) `notification_email` to get
SNS emails during the demo. This deploys, in dependency order: VPC → EKS
cluster → ECR → S3 → RDS → DynamoDB → SNS/EventBridge → Lambda functions →
API Gateway → bastion → IRSA roles → CloudWatch → namespace + service accounts
on the cluster.

**This takes ~20–25 minutes** (EKS + RDS creation are the slow parts) — a
natural point to switch to an architecture-diagram slide during a live demo.

### 4. AWS Load Balancer Controller

This is handled automatically now — `deploy-infra.yml` deploys the IAM
policy + IRSA role for the controller (`infrastructure/13-alb-controller-irsa.yaml`)
and installs it via Helm as part of the workflow. No manual step needed.

### 5. Push to `main`

Changes under `services/**` trigger **Deploy Services** (also resolves the
RDS host, DB secret ARN, and SNS topic ARN from CloudFormation outputs and
injects them into the pod env at rollout time). Changes under `frontend/**`
trigger **Deploy Frontend**. Both also support manual `workflow_dispatch`.

## Demo script (suggested flow)

1. **Show the AWS services table above** as a slide — 12 services, one system.
2. **Trigger `deploy-infra.yml`**, walk the CloudFormation console as stacks
   progress — good moment to explain IRSA and OIDC (no static credentials
   anywhere in the whole pipeline).
3. **Open the S3 site**, log in (`admin` / `demo123`), tour the sidebar.
4. **Products page** — data is read live from DynamoDB.
5. **Orders page** — `POST /api/orders` (via curl or a "place order" button
   you add) writes to RDS *and* fires an EventBridge event.
6. **Show the Lambda console** — `ProcessOrder` invocation appears seconds
   later; check the `OrderEvents` DynamoDB table for the new row.
7. **Check email / SNS console** — the order notification lands.
8. **Analytics page** — same order event now shows up via the completely
   separate API Gateway → Lambda → DynamoDB serverless path.
9. **CloudWatch dashboard** — show RDS CPU, Lambda invocations, and DynamoDB
   capacity all in one place.
10. **Bastion**: `aws ssm start-session --target <instance-id>` then `psql`
    into RDS directly, to show the data behind the API.

## Verifying the cluster

```bash
kubectl get nodes
kubectl get pods -n eks-demo
kubectl get sa -n eks-demo
kubectl get ingress -n eks-demo
kubectl logs deployment/order-service -n eks-demo
```

## Cost and cleanup notes

Running: EKS control plane + 2× t3.medium nodes + NAT gateway + ALB + RDS
db.t3.micro + bastion t3.micro + Lambda/DynamoDB/SNS/EventBridge (mostly
pay-per-use, negligible at demo volume) — roughly **$6–9/day**. Tear down
after the demo:

```bash
kubectl delete -f k8s/ingress.yaml
helm uninstall aws-load-balancer-controller -n kube-system

for stack in eks-demo-cloudwatch eks-demo-irsa eks-demo-bastion \
             eks-demo-api-gateway eks-demo-lambdas eks-demo-messaging \
             eks-demo-dynamodb eks-demo-rds eks-demo-cluster \
             eks-demo-ecr eks-demo-frontend-bucket eks-demo-vpc; do
  aws cloudformation delete-stack --stack-name $stack
  aws cloudformation wait stack-delete-complete --stack-name $stack
done

aws cloudformation delete-stack --stack-name eks-demo-github-oidc
```

(S3 bucket contents must be emptied — `aws s3 rm s3://<bucket> --recursive`
— before its stack will delete.)

## Notes for a production hardening follow-up

- Scope the GitHub Actions IAM policy down from broad service actions to the
  specific resources actually touched.
- Add HTTPS: ACM certificate + Route 53 + CloudFront/ALB listener on 443.
- Multi-AZ RDS, automated backups, and deletion protection for anything
  beyond a demo.
- Real authentication (Cognito, or an auth-service backed by RDS/DynamoDB)
  instead of the client-side demo login.
- VPC endpoints for DynamoDB/S3/Secrets Manager so traffic from private
  subnets doesn't need the NAT gateway.
