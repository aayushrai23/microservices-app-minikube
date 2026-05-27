# EKS MicroPay — Microservices on Kubernetes

> A full-stack microservices application deployed on a local **kind** (Kubernetes IN Docker) cluster with MongoDB, NGINX Ingress, and service-to-service communication.

---

## 🏗️ Architecture

```
Browser
  └── NGINX Ingress Controller
        ├── /api/auth/*    → Auth Service (Node.js)
        ├── /api/payment/* → Payment Service (Node.js)
        ├── /api/notify/*  → Notification Service (Node.js)
        └── /*             → Frontend (Next.js)
                                    ↓
                             MongoDB (Single instance)
                             ├── authdb
                             ├── paymentdb
                             └── notificationdb
```

---

## 🧩 Services

| Service | Port | Tech | Description |
|---|---|---|---|
| **Frontend** | 3000 | Next.js 14 + Tailwind | Dashboard UI — login, payments, notifications |
| **Auth Service** | 3001 | Node.js + Express + JWT | Register, login, token verify |
| **Payment Service** | 3002 | Node.js + Express | Process payments, call notification service |
| **Notification Service** | 3003 | Node.js + Express | Store and serve notifications |
| **MongoDB** | 27017 | MongoDB 6.0 | Single instance — 3 separate databases |

---

## 🔄 Service Communication

```
Frontend (3000)
  │
  ├── POST /api/auth/login      → Auth Service (3001)  → MongoDB authdb
  ├── POST /api/auth/register   → Auth Service (3001)  → MongoDB authdb
  │
  ├── POST /api/payment         → Payment Service (3002)
  │                                  ├── Verify JWT → Auth Service (3001)
  │                                  ├── Save payment → MongoDB paymentdb
  │                                  └── Notify → Notification Service (3003)
  │                                                    └── MongoDB notificationdb
  │
  └── GET /api/notify/user/:id  → Notification Service (3003) → MongoDB notificationdb
```

---

## 📁 Project Structure

```
microservices-app/
├── auth-service/
│   ├── src/
│   │   ├── index.js
│   │   ├── db.js               # MongoDB + Mongoose User schema
│   │   ├── middleware/auth.js  # JWT middleware
│   │   └── routes/auth.js      # Register, Login, Me, Verify
│   ├── Dockerfile
│   └── package.json
│
├── payment-service/
│   ├── src/
│   │   ├── index.js
│   │   ├── db.js               # MongoDB + Mongoose Payment schema
│   │   └── routes/payment.js   # Create payment, My payments
│   ├── Dockerfile
│   └── package.json
│
├── notification-service/
│   ├── src/
│   │   ├── index.js
│   │   ├── db.js               # MongoDB + Mongoose Notification schema
│   │   └── routes/notification.js
│   ├── Dockerfile
│   └── package.json
│
├── frontend/
│   ├── pages/
│   │   ├── _app.js
│   │   ├── index.js            # Dashboard
│   │   └── login.js            # Login / Register
│   ├── lib/api.js              # Axios API helpers — relative URLs
│   ├── Dockerfile              # Multi-stage build
│   └── package.json
│
├── k8s/
│   ├── namespace/
│   │   └── namespaces.yaml     # microservices + mongodb namespaces
│   ├── mongodb/
│   │   ├── secret.yaml         # MongoDB root credentials
│   │   ├── configmap.yaml      # MongoDB host config
│   │   ├── pvc.yaml            # 1Gi persistent storage
│   │   ├── deployment.yaml     # MongoDB deployment
│   │   └── service.yaml        # ClusterIP service
│   ├── auth/
│   │   ├── secret.yaml         # JWT secret
│   │   ├── configmap.yaml      # MONGO_URI, PORT
│   │   ├── deployment.yaml
│   │   └── service.yaml
│   ├── payment/
│   │   ├── configmap.yaml      # MONGO_URI, AUTH_URL, NOTIF_URL
│   │   ├── deployment.yaml
│   │   └── service.yaml
│   ├── notification/
│   │   ├── configmap.yaml      # MONGO_URI, PORT
│   │   ├── deployment.yaml
│   │   └── service.yaml
│   ├── frontend/
│   │   ├── deployment.yaml
│   │   └── service.yaml
│   └── ingress/
│       └── ingress.yaml        # NGINX path-based routing
│
├── kind-config.yaml            # kind cluster config
└── docker-compose.yml          # Local dev (optional)
```

---

## 🚀 Setup — kind Cluster (Local)

### Prerequisites

- Docker installed and running
- kubectl installed
- kind installed

### Step 1 — Install kind

```bash
curl -Lo ./kind https://kind.sigs.k8s.io/dl/v0.22.0/kind-linux-amd64
chmod +x ./kind
sudo mv ./kind /usr/local/bin/kind
```

### Step 2 — Create cluster

```bash
kind create cluster --name microservices-dev --config kind-config.yaml
```

`kind-config.yaml` spins up 1 control-plane + 3 worker nodes with port 80/443 mapped to host.

### Step 3 — Install StorageClass

```bash
kubectl apply -f https://raw.githubusercontent.com/rancher/local-path-provisioner/master/deploy/local-path-storage.yaml

kubectl patch storageclass local-path \
  -p '{"metadata":{"annotations":{"storageclass.kubernetes.io/is-default-class":"true"}}}'
```

### Step 4 — Install NGINX Ingress Controller

```bash
kubectl apply -f https://raw.githubusercontent.com/kubernetes/ingress-nginx/main/deploy/static/provider/kind/deploy.yaml

kubectl wait --namespace ingress-nginx \
  --for=condition=ready pod \
  --selector=app.kubernetes.io/component=controller \
  --timeout=120s
```

### Step 5 — Build and load Docker images

```bash
docker build -t auth-service:v1 ./auth-service
docker build -t payment-service:v1 ./payment-service
docker build -t notification-service:v1 ./notification-service
docker build -t frontend:v1 ./frontend

kind load docker-image auth-service:v1 --name microservices-dev
kind load docker-image payment-service:v1 --name microservices-dev
kind load docker-image notification-service:v1 --name microservices-dev
kind load docker-image frontend:v1 --name microservices-dev
```

### Step 6 — Deploy everything

```bash
# Namespaces first
kubectl apply -f k8s/namespace/namespaces.yaml

# MongoDB
kubectl apply -f k8s/mongodb/secret.yaml
kubectl apply -f k8s/mongodb/configmap.yaml
kubectl apply -f k8s/mongodb/pvc.yaml
kubectl apply -f k8s/mongodb/deployment.yaml
kubectl apply -f k8s/mongodb/service.yaml

# Auth service
kubectl apply -f k8s/auth/secret.yaml
kubectl apply -f k8s/auth/configmap.yaml
kubectl apply -f k8s/auth/deployment.yaml
kubectl apply -f k8s/auth/service.yaml

# Payment service
kubectl apply -f k8s/payment/configmap.yaml
kubectl apply -f k8s/payment/deployment.yaml
kubectl apply -f k8s/payment/service.yaml

# Notification service
kubectl apply -f k8s/notification/configmap.yaml
kubectl apply -f k8s/notification/deployment.yaml
kubectl apply -f k8s/notification/service.yaml

# Frontend
kubectl apply -f k8s/frontend/deployment.yaml
kubectl apply -f k8s/frontend/service.yaml

# Ingress
kubectl apply -f k8s/ingress/ingress.yaml
```

### Step 7 — Access the app

```bash
# Port forward
kubectl port-forward svc/ingress-nginx-controller \
  8080:80 -n ingress-nginx --address 0.0.0.0
```

Open browser:
```
http://<YOUR-VM-IP>:8080/login
```

---

## 🔍 Verify Deployment

```bash
# All pods running
kubectl get pods -n microservices -o wide
kubectl get pods -n mongodb -o wide

# Services
kubectl get svc -n microservices
kubectl get svc -n mongodb

# Ingress
kubectl get ingress -n microservices

# PVC bound
kubectl get pvc -n mongodb
```

Expected output:
```
NAME                        READY   STATUS    NODE
auth-service-xxx            1/1     Running   worker2
payment-service-xxx         1/1     Running   worker3
notification-service-xxx    1/1     Running   worker2
frontend-xxx                1/1     Running   worker3
mongodb-xxx                 1/1     Running   worker1
```

---

## 🧠 Kubernetes Concepts Demonstrated

| Concept | Where used |
|---|---|
| **Namespaces** | `microservices` for app, `mongodb` for database |
| **Deployments** | All 5 services |
| **Services (ClusterIP)** | Internal communication between pods |
| **Ingress** | Path-based routing via NGINX |
| **Secrets** | MongoDB credentials, JWT secret |
| **ConfigMaps** | Service URLs, MongoDB URIs, ports |
| **PVC + PV** | MongoDB persistent storage |
| **StorageClass** | Dynamic PV provisioning via local-path |
| **Labels + Selectors** | Service → Pod wiring |
| **Resource Requests/Limits** | Scheduler-aware pod placement |
| **imagePullPolicy: Never** | Local images in kind |
| **Cross-namespace DNS** | `mongodb-service.mongodb.svc.cluster.local` |

---

## 🌐 API Reference

### Auth Service — `/api/auth`

| Method | Endpoint | Auth | Description |
|---|---|---|---|
| POST | `/api/auth/register` | ❌ | Register new user |
| POST | `/api/auth/login` | ❌ | Login, returns JWT |
| GET | `/api/auth/me` | ✅ | Get current user |
| POST | `/api/auth/verify` | ✅ | Verify JWT (used by payment service) |
| GET | `/health` | ❌ | Health check |

### Payment Service — `/api/payment`

| Method | Endpoint | Auth | Description |
|---|---|---|---|
| POST | `/api/payment` | ✅ | Create payment |
| GET | `/api/payment/my` | ✅ | My payments |
| GET | `/health` | ❌ | Health check |

### Notification Service — `/api/notify`

| Method | Endpoint | Auth | Description |
|---|---|---|---|
| POST | `/api/notify/send` | ❌ | Send notification (internal) |
| GET | `/api/notify/user/:id` | ❌ | User notifications |
| GET | `/health` | ❌ | Health check |

---

## 🗄️ Database Schema

### authdb — `users`
```
_id         ObjectId (auto)
name        String
email       String (unique)
password    String (bcrypt hashed)
role        String (default: 'user')
created_at  Date
```

### paymentdb — `payments`
```
_id             ObjectId (auto)
user_id         String
amount          Number
currency        String (default: 'USD')
status          String ('completed' | 'failed')
description     String
payment_method  String (default: 'card')
transaction_id  String
created_at      Date
```

### notificationdb — `notifications`
```
_id         ObjectId (auto)
user_id     String
type        String ('payment' | 'general')
subject     String
message     String
email       String
status      String (default: 'sent')
created_at  Date
```

---

## 🔐 Security

- JWT tokens with 7-day expiry
- Passwords hashed with bcrypt (12 rounds)
- Each service has its own isolated database
- Service-to-service auth via token verification
- Secrets stored in Kubernetes Secret objects (base64 encoded)
- `imagePullPolicy: Never` — no accidental public image pulls

---

## 🐛 Common Issues

| Issue | Cause | Fix |
|---|---|---|
| `ImagePullBackOff` | Image not loaded in kind | `kind load docker-image <image> --name <cluster>` |
| `CreateContainerConfigError` | Secret/ConfigMap key mismatch | Check exact key names in Secret/ConfigMap |
| Pod `Pending` | PVC unbound or taint issue | `kubectl describe pod` → check Events |
| `404` on API routes | Ingress rewrite stripping prefix | Remove `rewrite-target` annotation |
| Webhook error on Ingress apply | Admission webhook not ready | `kubectl delete validatingwebhookconfiguration ingress-nginx-admission` |

---

## 🏗️ Infrastructure (Coming Next — Phase 2)

```
terraform/
├── modules/
│   ├── vpc/        # VPC, public/private subnets, NAT Gateway
│   ├── eks/        # EKS cluster + managed node groups
│   ├── rds/        # PostgreSQL RDS Multi-AZ
│   └── iam/        # IAM roles, IRSA policies
└── environments/
    ├── dev/
    └── prod/
```

---

## 📄 License

MIT License — free to use for learning and projects.

---

<div align="center">
Built for learning Kubernetes, kind, and microservices architecture ⭐
</div>
