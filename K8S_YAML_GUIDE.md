# K8s YAML Mastery — Learn by Building

## How This Guide Works

Each section follows the same pattern:
1. **Concept** — what this resource is and why it exists
2. **Fields explained** — every field you will write, what it means
3. **Try it yourself** — write it from scratch first
4. **Solution** — the actual YAML for our app
5. **Verify** — commands to confirm it worked

Do NOT skip to the solution. Write it yourself first. The struggle is where learning happens.

---

## Architecture — Two Namespaces, One App

```
Namespace: database          Namespace: services
┌──────────────────┐         ┌─────────────────────────────────────────┐
│                  │         │                                         │
│   MongoDB        │◄────────│  auth-service                           │
│   (StatefulDB)   │◄────────│  payment-service                        │
│                  │◄────────│  notification-service                   │
└──────────────────┘         │  frontend                               │
                             │                                         │
                             │  Ingress (entry point from browser)     │
                             └─────────────────────────────────────────┘
```

### Why two namespaces?
- **Separation of concern** — databases are infrastructure, services are application
- **Independent lifecycle** — you can tear down `services` namespace without touching data
- **Real production pattern** — teams own different namespaces, different RBAC rules

### How services talk across namespaces

Inside the same namespace, a service is reachable by its short name:
```
http://auth-service:3001
```

Across namespaces, you MUST use the full DNS name:
```
http://mongodb-service.database.svc.cluster.local:27017
```

The pattern is always:
```
<service-name>.<namespace>.svc.cluster.local:<port>
```

This is how `auth-service`, `payment-service`, and `notification-service` — all in the `services` namespace — connect to MongoDB in the `database` namespace.

### Full communication map

```
Browser
  │
  ▼
Ingress (services namespace)
  ├── /api/auth/*    ──► auth-service:3001
  ├── /api/payment/* ──► payment-service:3002
  ├── /api/notify/*  ──► notification-service:3003
  └── /*             ──► frontend:3000

payment-service ──► auth-service:3001          (same namespace, short name)
payment-service ──► notification-service:3003  (same namespace, short name)

auth-service         ──► mongodb-service.database.svc.cluster.local:27017/authdb
payment-service      ──► mongodb-service.database.svc.cluster.local:27017/paymentdb
notification-service ──► mongodb-service.database.svc.cluster.local:27017/notificationdb
```

### File structure you will build

```
k8s/
├── namespace/
│   └── namespaces.yaml
├── mongodb/
│   ├── secret.yaml
│   ├── configmap.yaml
│   ├── pvc.yaml
│   ├── deployment.yaml
│   └── service.yaml
├── auth/
│   ├── secret.yaml
│   ├── configmap.yaml
│   ├── deployment.yaml
│   └── service.yaml
├── notification/
│   ├── secret.yaml
│   ├── configmap.yaml
│   ├── deployment.yaml
│   └── service.yaml
├── payment/
│   ├── secret.yaml
│   ├── configmap.yaml
│   ├── deployment.yaml
│   └── service.yaml
├── frontend/
│   ├── deployment.yaml
│   └── service.yaml
└── ingress/
    └── ingress.yaml
```

---

## Phase 1 — Namespaces

### Concept

A Namespace is a logical partition inside your cluster. Every resource (Pod, Service, Secret, etc.) lives inside a namespace. If you don't specify one, resources go into the `default` namespace.

Think of it like separate folders — resources in one namespace cannot accidentally conflict with resources in another, even if they have the same name.

### Fields explained

```yaml
apiVersion: v1          # Namespaces use the core v1 API
kind: Namespace         # Resource type
metadata:
  name: database        # The name of this namespace — this is what you reference everywhere
```

The `---` separator lets you put multiple resources in one file.

### Try it yourself

Create `k8s/namespace/namespaces.yaml`. You need two namespaces: `database` and `services`.

### Solution

```yaml
# k8s/namespace/namespaces.yaml
apiVersion: v1
kind: Namespace
metadata:
  name: database
---
apiVersion: v1
kind: Namespace
metadata:
  name: services
```

### Verify

```bash
kubectl apply -f k8s/namespace/namespaces.yaml
kubectl get namespaces
```

Expected output includes:
```
database   Active   ...
services   Active   ...
```

---

## Phase 2 — Secrets

### Concept

A Secret stores sensitive data — passwords, tokens, connection strings — in base64 encoded form. It is NOT encrypted by default (just encoded), but it is stored separately from your config so you never hardcode credentials in Deployments.

**Why base64?** Kubernetes stores YAML as JSON internally. base64 ensures binary-safe storage of any value including special characters like `@`, `/`, `?` in a MongoDB URI.

### How to generate base64 values

```bash
echo -n "your-value-here" | base64
```

The `-n` flag is critical — it prevents a trailing newline from being included in the encoded value. Without it, your secret will have a hidden `\n` at the end and connections will fail.

To decode:
```bash
echo "YWRtaW4=" | base64 -d
```

### Fields explained

```yaml
apiVersion: v1
kind: Secret
metadata:
  name: mongodb-secret      # Name you reference in Deployments
  namespace: database       # Must match the namespace of the resource using it
type: Opaque                # Generic secret — "Opaque" means arbitrary key-value pairs
data:
  SOME_KEY: base64value==   # Key is the env var name, value is base64 encoded
```

**Important:** A Secret in the `database` namespace can ONLY be used by resources IN the `database` namespace. Services in the `services` namespace need their own secrets.

### Try it yourself

For MongoDB, you need:
- `MONGO_ROOT_USERNAME` = admin
- `MONGO_ROOT_PASSWORD` = password123

For auth-service, you need:
- `MONGO_URI` = full connection string to authdb
- `JWT_SECRET` = your own strong random string (generate it — see below)

For payment-service, you need:
- `MONGO_URI` = full connection string to paymentdb

For notification-service, you need:
- `MONGO_URI` = full connection string to notificationdb

### Generate your JWT Secret

Never use a guessable string for JWT_SECRET. Generate a strong random one:

```bash
openssl rand -base64 32
```

Example output:
```
K7mP2xQnR9vL4wJ8sH1tY6uI3oE5aB0cXdZqWs==
```

Now base64 encode it for the Secret YAML:

```bash
echo -n "K7mP2xQnR9vL4wJ8sH1tY6uI3oE5aB0cXdZqWs==" | base64
```

Use YOUR generated value — not the one shown here. The `openssl rand -base64 32` output is different every time you run it, which is the point.

---

### Solution

**MongoDB secret** — used by the MongoDB container itself to create the root user:

```yaml
# k8s/mongodb/secret.yaml
apiVersion: v1
kind: Secret
metadata:
  name: mongodb-secret
  namespace: database
type: Opaque
data:
  MONGO_ROOT_USERNAME: YWRtaW4=          # admin
  MONGO_ROOT_PASSWORD: cGFzc3dvcmQxMjM=  # password123
```

**Auth service secret** — MONGO_URI crosses namespace boundary so full DNS name is used:

```yaml
# k8s/auth/secret.yaml
apiVersion: v1
kind: Secret
metadata:
  name: auth-secret
  namespace: services
type: Opaque
data:
  # mongodb://admin:password123@mongodb-service.database.svc.cluster.local:27017/authdb?authSource=admin
  MONGO_URI: bW9uZ29kYjovL2FkbWluOnBhc3N3b3JkMTIzQG1vbmdvZGItc2VydmljZS5kYXRhYmFzZS5zdmMuY2x1c3Rlci5sb2NhbDoyNzAxNy9hdXRoZGI/YXV0aFNvdXJjZT1hZG1pbg==
  # your own value from: openssl rand -base64 32 | then base64 encode it
  JWT_SECRET: <your-base64-encoded-jwt-secret>
```

**Payment service secret:**

```yaml
# k8s/payment/secret.yaml
apiVersion: v1
kind: Secret
metadata:
  name: payment-secret
  namespace: services
type: Opaque
data:
  # mongodb://admin:password123@mongodb-service.database.svc.cluster.local:27017/paymentdb?authSource=admin
  MONGO_URI: bW9uZ29kYjovL2FkbWluOnBhc3N3b3JkMTIzQG1vbmdvZGItc2VydmljZS5kYXRhYmFzZS5zdmMuY2x1c3Rlci5sb2NhbDoyNzAxNy9wYXltZW50ZGI/YXV0aFNvdXJjZT1hZG1pbg==
```

**Notification service secret:**

```yaml
# k8s/notification/secret.yaml
apiVersion: v1
kind: Secret
metadata:
  name: notification-secret
  namespace: services
type: Opaque
data:
  # mongodb://admin:password123@mongodb-service.database.svc.cluster.local:27017/notificationdb?authSource=admin
  MONGO_URI: bW9uZ29kYjovL2FkbWluOnBhc3N3b3JkMTIzQG1vbmdvZGItc2VydmljZS5kYXRhYmFzZS5zdmMuY2x1c3Rlci5sb2NhbDoyNzAxNy9ub3RpZmljYXRpb25kYj9hdXRoU291cmNlPWFkbWlu
```

### Verify

```bash
kubectl apply -f k8s/mongodb/secret.yaml
kubectl apply -f k8s/auth/secret.yaml
kubectl apply -f k8s/payment/secret.yaml
kubectl apply -f k8s/notification/secret.yaml

# List secrets in each namespace
kubectl get secrets -n database
kubectl get secrets -n services

# Peek at a secret (shows base64)
kubectl get secret auth-secret -n services -o yaml

# Decode a specific key
kubectl get secret auth-secret -n services -o jsonpath='{.data.JWT_SECRET}' | base64 -d
```

---

## Phase 3 — ConfigMaps

### Concept

A ConfigMap stores non-sensitive configuration — port numbers, service URLs, feature flags. Unlike Secrets, values are plain text (not base64). Use ConfigMap for anything you are comfortable seeing in `kubectl describe`.

Rule of thumb:
- Password, token, connection string with credentials → **Secret**
- Port number, service URL, feature flag → **ConfigMap**

### Fields explained

```yaml
apiVersion: v1
kind: ConfigMap
metadata:
  name: auth-config
  namespace: services
data:
  PORT: "3001"                      # Values must always be strings — wrap numbers in quotes
  SOME_URL: "http://service:3001"   # Plain text, no base64
```

### Try it yourself

For MongoDB ConfigMap (in `database` namespace):
- `MONGO_HOST` = mongodb-service.database.svc.cluster.local
- `MONGO_PORT` = 27017

For auth-service ConfigMap (in `services` namespace):
- `PORT` = 3001

For payment-service ConfigMap — this has more config:
- `PORT` = 3002
- `AUTH_SERVICE_URL` = URL to reach auth-service (same namespace)
- `NOTIFICATION_SERVICE_URL` = URL to reach notification-service (same namespace)

For notification-service ConfigMap:
- `PORT` = 3003

### Solution

**MongoDB ConfigMap:**

```yaml
# k8s/mongodb/configmap.yaml
apiVersion: v1
kind: ConfigMap
metadata:
  name: mongodb-config
  namespace: database
data:
  MONGO_HOST: "mongodb-service.database.svc.cluster.local"
  MONGO_PORT: "27017"
```

**Auth service ConfigMap:**

```yaml
# k8s/auth/configmap.yaml
apiVersion: v1
kind: ConfigMap
metadata:
  name: auth-config
  namespace: services
data:
  PORT: "3001"
```

**Payment service ConfigMap:**

```yaml
# k8s/payment/configmap.yaml
apiVersion: v1
kind: ConfigMap
metadata:
  name: payment-config
  namespace: services
data:
  PORT: "3002"
  AUTH_SERVICE_URL: "http://auth-service:3001"
  NOTIFICATION_SERVICE_URL: "http://notification-service:3003"
```

Notice: `auth-service` and `notification-service` use SHORT names (no namespace suffix) because payment-service is in the same `services` namespace.

**Notification service ConfigMap:**

```yaml
# k8s/notification/configmap.yaml
apiVersion: v1
kind: ConfigMap
metadata:
  name: notification-config
  namespace: services
data:
  PORT: "3003"
```

### Verify

```bash
kubectl apply -f k8s/mongodb/configmap.yaml
kubectl apply -f k8s/auth/configmap.yaml
kubectl apply -f k8s/payment/configmap.yaml
kubectl apply -f k8s/notification/configmap.yaml

kubectl get configmaps -n database
kubectl get configmaps -n services

# See the actual values
kubectl describe configmap payment-config -n services
```

---

## Phase 4 — PersistentVolumeClaim (PVC)

### Concept

A PVC is a request for storage. Your pod says "I need 1Gi of disk" and Kubernetes finds (or creates) a PersistentVolume that satisfies the request.

**PV (PersistentVolume)** — the actual disk. In Minikube, the cluster creates this automatically.
**PVC (PersistentVolumeClaim)** — your request for a piece of that disk.
**StorageClass** — the type of storage. In Minikube, `standard` is available by default.

Why does MongoDB need this? Containers are ephemeral — if the pod restarts, all data is lost. A PVC mounts external storage into the pod so data persists across restarts.

---

### The 3-layer storage chain

```
StorageClass  →  PersistentVolume (PV)  →  PersistentVolumeClaim (PVC)
   (how)              (what exists)              (what you asked for)
```

**StorageClass** defines how storage gets provisioned. Check what Minikube has:

```bash
kubectl get storageclass
```

Output:
```
NAME                 PROVISIONER                RECLAIMPOLICY   VOLUMEBINDINGMODE
standard (default)   k8s.io/minikube-hostpath   Delete          Immediate
```

- `k8s.io/minikube-hostpath` — creates a real folder on the node's disk and mounts it into the pod
- `Delete` — when you delete the PVC, the PV and data are also deleted automatically
- `Immediate` — PV is created the moment PVC is applied, no need to wait for a pod

**Important:** StorageClass has NO fixed size limit — `Parameters: <none>`. The actual limit is the node's physical disk. Check your node capacity:

```bash
kubectl get nodes -o custom-columns="NODE:.metadata.name,CPU:.status.capacity.cpu,MEMORY:.status.capacity.memory,STORAGE:.status.capacity.ephemeral-storage"
```

Whatever your node's disk is — that is your total available storage across all PVCs.

---

### When does PV get created?

This is a common confusion point.

```bash
kubectl get pv   # shows nothing right now
```

**PV is NOT created when you write the StorageClass or when the cluster starts.**
PV is created only when you apply a PVC. The StorageClass provisioner reacts to your PVC request and creates the PV on demand.

```
kubectl get pv       ← empty, nothing yet
        ↓
kubectl apply -f k8s/mongodb/pvc.yaml
        ↓
StorageClass provisioner runs automatically
        ↓
kubectl get pv       ← PV appears now, auto-created
kubectl get pvc -n database   ← shows Bound
```

So if you run `kubectl get pv` right now on a fresh cluster, you will see nothing — that is correct and expected.

### Fields explained

```yaml
apiVersion: v1
kind: PersistentVolumeClaim
metadata:
  name: mongodb-pvc
  namespace: database          # PVC must be in same namespace as the pod using it
spec:
  accessModes:
    - ReadWriteOnce            # Only one node can mount this at a time (fine for single MongoDB)
  resources:
    requests:
      storage: 1Gi             # How much disk you need
  storageClassName: standard   # Minikube's default storage class
```

**accessModes options:**
- `ReadWriteOnce` — one node, read+write (most databases use this)
- `ReadOnlyMany` — many nodes, read only
- `ReadWriteMany` — many nodes, read+write (requires special storage like NFS/EFS)

### Try it yourself

Create `k8s/mongodb/pvc.yaml`. MongoDB needs 1Gi, ReadWriteOnce, storageClassName standard.

### Solution

```yaml
# k8s/mongodb/pvc.yaml
apiVersion: v1
kind: PersistentVolumeClaim
metadata:
  name: mongodb-pvc
  namespace: database
spec:
  accessModes:
    - ReadWriteOnce
  resources:
    requests:
      storage: 1Gi
  storageClassName: standard
```

### Verify

```bash
# Before applying — confirm PV is empty
kubectl get pv

# Apply PVC
kubectl apply -f k8s/mongodb/pvc.yaml

# PVC immediately goes to Bound (because VolumeBindingMode is Immediate)
kubectl get pvc -n database
```

Expected:
```
NAME          STATUS   VOLUME                                     CAPACITY   STORAGECLASS
mongodb-pvc   Bound    pvc-3f2a1b4c-xxxx-xxxx-xxxx-xxxxxxxxxxxx   1Gi        standard
```

```bash
# PV is now auto-created by StorageClass
kubectl get pv
```

Expected:
```
NAME                                       CAPACITY   ACCESS MODES   RECLAIM POLICY   STATUS   CLAIM
pvc-3f2a1b4c-xxxx-xxxx-xxxx-xxxxxxxxxxxx   1Gi        RWO            Delete           Bound    database/mongodb-pvc
```

Notice `CLAIM` column shows `database/mongodb-pvc` — this PV is now locked to your PVC and nothing else can use it.

---

## Phase 5 — Deployments

### Concept

A Deployment manages Pods. It ensures the desired number of replicas are always running. If a pod crashes, the Deployment controller creates a new one.

The Deployment does NOT run your container directly — it creates a ReplicaSet, which creates Pods.

```
Deployment
  └── ReplicaSet
        ├── Pod (replica 1)
        └── Pod (replica 2)
```

### Fields explained — the full Deployment anatomy

```yaml
apiVersion: apps/v1           # Deployments are in the apps group
kind: Deployment
metadata:
  name: auth-deployment
  namespace: services
  labels:
    app: auth-service         # Labels on the Deployment itself
spec:
  replicas: 1                 # How many pod copies to run
  selector:
    matchLabels:
      app: auth-service       # The Deployment manages pods WITH these labels
  template:                   # This is the pod template — every pod created will look like this
    metadata:
      labels:
        app: auth-service     # MUST match selector.matchLabels above
    spec:
      containers:
        - name: auth-service
          image: auth-service:v1
          imagePullPolicy: Never    # Use local image — critical for Minikube
          ports:
            - containerPort: 3001
          envFrom:                  # Load ALL keys from ConfigMap as env vars
            - configMapRef:
                name: auth-config
          env:                      # Load specific keys from Secret
            - name: MONGO_URI
              valueFrom:
                secretKeyRef:
                  name: auth-secret
                  key: MONGO_URI
            - name: JWT_SECRET
              valueFrom:
                secretKeyRef:
                  name: auth-secret
                  key: JWT_SECRET
```

**envFrom vs env:**
- `envFrom.configMapRef` — loads ALL key-value pairs from a ConfigMap as environment variables at once
- `env[].valueFrom.secretKeyRef` — loads ONE specific key from a Secret as an env var

You can mix both: use `envFrom` for ConfigMap (all keys), and `env` with `secretKeyRef` for individual secret keys.

**imagePullPolicy: Never** — tells Kubernetes to never try to pull this image from a registry. Use this in Minikube where images are built locally with `eval $(minikube docker-env)`.

### How Deployment connects to Service (the selector mechanism)

```
Deployment spec.selector.matchLabels:  { app: auth-service }
                                              ▼ finds pods with
Pod metadata.labels:                   { app: auth-service }
                                              ▼ Service also finds same pods
Service spec.selector:                 { app: auth-service }
```

The label `app: auth-service` is the glue between Deployment, Pods, and Service.

### Try it yourself

Write all 5 deployments. Key things to remember:
- All service deployments go in `services` namespace, MongoDB in `database`
- `imagePullPolicy: Never` for all
- MongoDB needs a `volumeMounts` + `volumes` section to use the PVC
- MongoDB needs env vars from its Secret (root username/password)
- Services load config from ConfigMap via `envFrom` and secrets via `env`

### Solution

**MongoDB Deployment:**

```yaml
# k8s/mongodb/deployment.yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: mongodb-deployment
  namespace: database
  labels:
    app: mongodb
spec:
  replicas: 1
  selector:
    matchLabels:
      app: mongodb
  template:
    metadata:
      labels:
        app: mongodb
    spec:
      containers:
        - name: mongodb
          image: mongo:6.0
          imagePullPolicy: IfNotPresent
          ports:
            - containerPort: 27017
          env:
            - name: MONGO_INITDB_ROOT_USERNAME
              valueFrom:
                secretKeyRef:
                  name: mongodb-secret
                  key: MONGO_ROOT_USERNAME
            - name: MONGO_INITDB_ROOT_PASSWORD
              valueFrom:
                secretKeyRef:
                  name: mongodb-secret
                  key: MONGO_ROOT_PASSWORD
          volumeMounts:
            - name: mongodb-storage
              mountPath: /data/db        # MongoDB writes data here inside the container
      volumes:
        - name: mongodb-storage
          persistentVolumeClaim:
            claimName: mongodb-pvc       # Must match metadata.name of your PVC
```

**Auth Service Deployment:**

```yaml
# k8s/auth/deployment.yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: auth-deployment
  namespace: services
  labels:
    app: auth-service
spec:
  replicas: 1
  selector:
    matchLabels:
      app: auth-service
  template:
    metadata:
      labels:
        app: auth-service
    spec:
      containers:
        - name: auth-service
          image: auth-service:v1
          imagePullPolicy: Never
          ports:
            - containerPort: 3001
          envFrom:
            - configMapRef:
                name: auth-config
          env:
            - name: MONGO_URI
              valueFrom:
                secretKeyRef:
                  name: auth-secret
                  key: MONGO_URI
            - name: JWT_SECRET
              valueFrom:
                secretKeyRef:
                  name: auth-secret
                  key: JWT_SECRET
```

**Notification Service Deployment:**

```yaml
# k8s/notification/deployment.yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: notification-deployment
  namespace: services
  labels:
    app: notification-service
spec:
  replicas: 1
  selector:
    matchLabels:
      app: notification-service
  template:
    metadata:
      labels:
        app: notification-service
    spec:
      containers:
        - name: notification-service
          image: notification-service:v1
          imagePullPolicy: Never
          ports:
            - containerPort: 3003
          envFrom:
            - configMapRef:
                name: notification-config
          env:
            - name: MONGO_URI
              valueFrom:
                secretKeyRef:
                  name: notification-secret
                  key: MONGO_URI
```

**Payment Service Deployment:**

```yaml
# k8s/payment/deployment.yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: payment-deployment
  namespace: services
  labels:
    app: payment-service
spec:
  replicas: 1
  selector:
    matchLabels:
      app: payment-service
  template:
    metadata:
      labels:
        app: payment-service
    spec:
      containers:
        - name: payment-service
          image: payment-service:v1
          imagePullPolicy: Never
          ports:
            - containerPort: 3002
          envFrom:
            - configMapRef:
                name: payment-config
          env:
            - name: MONGO_URI
              valueFrom:
                secretKeyRef:
                  name: payment-secret
                  key: MONGO_URI
```

**Frontend Deployment:**

```yaml
# k8s/frontend/deployment.yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: frontend-deployment
  namespace: services
  labels:
    app: frontend
spec:
  replicas: 1
  selector:
    matchLabels:
      app: frontend
  template:
    metadata:
      labels:
        app: frontend
    spec:
      containers:
        - name: frontend
          image: frontend:v1
          imagePullPolicy: Never
          ports:
            - containerPort: 3000
          env:
            - name: NODE_ENV
              value: "production"
```

### Verify

```bash
# Apply all deployments
kubectl apply -f k8s/mongodb/deployment.yaml
kubectl apply -f k8s/auth/deployment.yaml
kubectl apply -f k8s/notification/deployment.yaml
kubectl apply -f k8s/payment/deployment.yaml
kubectl apply -f k8s/frontend/deployment.yaml

# Check pods in each namespace
kubectl get pods -n database
kubectl get pods -n services

# Watch pods come up in real time
kubectl get pods -n services -w

# If a pod is not Running, describe it to see why
kubectl describe pod <pod-name> -n services

# See container logs
kubectl logs <pod-name> -n services
```

---

## Phase 6 — Services

### Concept

A Service gives your pods a stable network address. Pods die and restart with new IPs — a Service sits in front and keeps a consistent DNS name and IP.

**Service types:**
- `ClusterIP` — only reachable inside the cluster. This is the default and what all our backend services use.
- `NodePort` — exposes a port on every cluster node. Used for direct testing.
- `LoadBalancer` — creates a cloud load balancer. Used in production on EKS/GKE/AKS.

For all our services, we use `ClusterIP` — they only need to talk to each other inside the cluster. The Ingress handles external traffic.

### How a Service finds its pods

```yaml
spec:
  selector:
    app: auth-service    # Service sends traffic to pods with this label
```

This selector MUST match the `metadata.labels` on the pods (which come from `spec.template.metadata.labels` in the Deployment).

### Fields explained

```yaml
apiVersion: v1
kind: Service
metadata:
  name: auth-service       # This name becomes the DNS hostname inside the cluster
  namespace: services
spec:
  type: ClusterIP          # Internal only
  selector:
    app: auth-service      # Route traffic to pods with this label
  ports:
    - port: 3001           # Port this Service listens on (what other services call)
      targetPort: 3001     # Port inside the container (matches containerPort in Deployment)
      protocol: TCP
```

**DNS name rule:** The Service `metadata.name` is the DNS name. So `name: auth-service` means other pods reach it at `auth-service` (same namespace) or `auth-service.services.svc.cluster.local` (any namespace).

### Try it yourself

Write Services for all 5 components. All backend services are ClusterIP. Remember:
- MongoDB service in `database` namespace
- All other services in `services` namespace

### Solution

**MongoDB Service:**

```yaml
# k8s/mongodb/service.yaml
apiVersion: v1
kind: Service
metadata:
  name: mongodb-service
  namespace: database
spec:
  type: ClusterIP
  selector:
    app: mongodb
  ports:
    - port: 27017
      targetPort: 27017
      protocol: TCP
```

This service is why our MONGO_URI uses `mongodb-service.database.svc.cluster.local` — the DNS name is built from `<metadata.name>.<namespace>.svc.cluster.local`.

**Auth Service:**

```yaml
# k8s/auth/service.yaml
apiVersion: v1
kind: Service
metadata:
  name: auth-service
  namespace: services
spec:
  type: ClusterIP
  selector:
    app: auth-service
  ports:
    - port: 3001
      targetPort: 3001
      protocol: TCP
```

**Notification Service:**

```yaml
# k8s/notification/service.yaml
apiVersion: v1
kind: Service
metadata:
  name: notification-service
  namespace: services
spec:
  type: ClusterIP
  selector:
    app: notification-service
  ports:
    - port: 3003
      targetPort: 3003
      protocol: TCP
```

**Payment Service:**

```yaml
# k8s/payment/service.yaml
apiVersion: v1
kind: Service
metadata:
  name: payment-service
  namespace: services
spec:
  type: ClusterIP
  selector:
    app: payment-service
  ports:
    - port: 3002
      targetPort: 3002
      protocol: TCP
```

**Frontend Service:**

```yaml
# k8s/frontend/service.yaml
apiVersion: v1
kind: Service
metadata:
  name: frontend-service
  namespace: services
spec:
  type: ClusterIP
  selector:
    app: frontend
  ports:
    - port: 3000
      targetPort: 3000
      protocol: TCP
```

### Verify

```bash
kubectl apply -f k8s/mongodb/service.yaml
kubectl apply -f k8s/auth/service.yaml
kubectl apply -f k8s/notification/service.yaml
kubectl apply -f k8s/payment/service.yaml
kubectl apply -f k8s/frontend/service.yaml

kubectl get services -n database
kubectl get services -n services

# Test cross-namespace DNS from inside a pod
# Exec into any running pod and try:
kubectl exec -it <auth-pod-name> -n services -- wget -qO- http://mongodb-service.database.svc.cluster.local:27017
```

---

## Phase 7 — Ingress

### Concept

An Ingress is a Layer 7 (HTTP) router that sits at the edge of your cluster. It receives external HTTP requests and routes them to the correct Service based on the URL path or hostname.

Without Ingress, you would need to expose each service separately. With Ingress, one entry point routes everything.

```
Browser: GET http://192.168.49.2/api/auth/login
                        │
                   Ingress Controller
                   (NGINX pod running in cluster)
                        │
                   reads Ingress rules:
                   /api/auth  → auth-service:3001
                   /api/payment → payment-service:3002
                   /api/notify → notification-service:3003
                   /          → frontend-service:3000
```

The **Ingress resource** (your YAML) defines the routing rules.
The **Ingress Controller** (NGINX pod) reads those rules and actually does the routing.
You enable the controller in Minikube with: `minikube addons enable ingress`

### Fields explained

```yaml
apiVersion: networking.k8s.io/v1     # Ingress is in the networking group
kind: Ingress
metadata:
  name: app-ingress
  namespace: services                # Ingress must be in same namespace as the Services it routes to
  annotations:
    nginx.ingress.kubernetes.io/rewrite-target: /$2   # Strip the path prefix before forwarding
spec:
  ingressClassName: nginx            # Use the NGINX ingress controller
  rules:
    - http:
        paths:
          - path: /api/auth(/|$)(.*)
            pathType: Prefix
            backend:
              service:
                name: auth-service   # Must match metadata.name of your Service
                port:
                  number: 3001
```

**Why `rewrite-target: /$2`?**

Your frontend calls `/api/auth/login`. But the auth service expects the request at `/api/auth/login` too — no rewrite needed there. However to be safe and handle path stripping when needed, the annotation captures groups so rewrites work correctly.

For our app, all services are designed to receive full paths including `/api/auth`, `/api/payment`, `/api/notify` — so we use a simpler regex that passes the full path through.

### Try it yourself

Write `k8s/ingress/ingress.yaml`. Route:
- `/api/auth` → `auth-service:3001`
- `/api/payment` → `payment-service:3002`
- `/api/notify` → `notification-service:3003`
- `/` → `frontend-service:3000`

### Solution

```yaml
# k8s/ingress/ingress.yaml
apiVersion: networking.k8s.io/v1
kind: Ingress
metadata:
  name: app-ingress
  namespace: services
  annotations:
    nginx.ingress.kubernetes.io/use-regex: "true"
spec:
  ingressClassName: nginx
  rules:
    - http:
        paths:
          - path: /api/auth
            pathType: Prefix
            backend:
              service:
                name: auth-service
                port:
                  number: 3001
          - path: /api/payment
            pathType: Prefix
            backend:
              service:
                name: payment-service
                port:
                  number: 3002
          - path: /api/notify
            pathType: Prefix
            backend:
              service:
                name: notification-service
                port:
                  number: 3003
          - path: /
            pathType: Prefix
            backend:
              service:
                name: frontend-service
                port:
                  number: 3000
```

**Order matters** — more specific paths (`/api/auth`, `/api/payment`, `/api/notify`) must come BEFORE the catch-all `/`. NGINX matches top to bottom.

### Verify

```bash
# Enable ingress addon first (only needed once)
minikube addons enable ingress

# Wait for ingress controller pod to be Running
kubectl get pods -n ingress-nginx -w

# Apply ingress
kubectl apply -f k8s/ingress/ingress.yaml
kubectl get ingress -n services

# Get the Minikube IP
minikube ip

# Test routes (replace IP with your minikube ip)
curl http://$(minikube ip)/api/auth/health
curl http://$(minikube ip)/api/payment/health
curl http://$(minikube ip)/api/notify/health
curl http://$(minikube ip)/
```

---

## Full Deploy Order — Step by Step

Run these commands in this exact order. Each step depends on the previous one.

```bash
# Step 0 — build images inside Minikube's Docker daemon
eval $(minikube docker-env)
cd ~/my-projects/microservices-app-eks

docker build -t auth-service:v1 ./auth-service
docker build -t payment-service:v1 ./payment-service
docker build -t notification-service:v1 ./notification-service
docker build -t frontend:v1 ./frontend

# Confirm images exist inside Minikube
docker images | grep -E "auth|payment|notification|frontend"

# Step 1 — namespaces (everything depends on these)
kubectl apply -f k8s/namespace/namespaces.yaml
kubectl get namespaces

# Step 2 — MongoDB (database namespace)
kubectl apply -f k8s/mongodb/secret.yaml
kubectl apply -f k8s/mongodb/configmap.yaml
kubectl apply -f k8s/mongodb/pvc.yaml
kubectl apply -f k8s/mongodb/deployment.yaml
kubectl apply -f k8s/mongodb/service.yaml

# Wait for MongoDB to be Running before continuing
kubectl get pods -n database -w
# Press Ctrl+C once it shows Running

# Step 3 — Auth service (payment depends on auth)
kubectl apply -f k8s/auth/secret.yaml
kubectl apply -f k8s/auth/configmap.yaml
kubectl apply -f k8s/auth/deployment.yaml
kubectl apply -f k8s/auth/service.yaml

kubectl get pods -n services -w

# Step 4 — Notification service (payment depends on notification)
kubectl apply -f k8s/notification/secret.yaml
kubectl apply -f k8s/notification/configmap.yaml
kubectl apply -f k8s/notification/deployment.yaml
kubectl apply -f k8s/notification/service.yaml

# Step 5 — Payment service
kubectl apply -f k8s/payment/secret.yaml
kubectl apply -f k8s/payment/configmap.yaml
kubectl apply -f k8s/payment/deployment.yaml
kubectl apply -f k8s/payment/service.yaml

# Step 6 — Frontend
kubectl apply -f k8s/frontend/deployment.yaml
kubectl apply -f k8s/frontend/service.yaml

# Step 7 — Ingress (after all services are up)
minikube addons enable ingress
kubectl get pods -n ingress-nginx -w   # wait for controller to be Running
kubectl apply -f k8s/ingress/ingress.yaml

# Final check — all pods
kubectl get pods -n database
kubectl get pods -n services
kubectl get ingress -n services
```

---

## Troubleshooting

### Pod stuck in Pending

```bash
kubectl describe pod <pod-name> -n <namespace>
```

Look for `Events` section at the bottom. Common causes:
- `Insufficient cpu/memory` — too many pods for your Minikube resources
- `0/3 nodes are available` — node selector or affinity issue
- `PVC not bound` — storage class issue

### Pod stuck in CrashLoopBackOff

```bash
kubectl logs <pod-name> -n <namespace>
kubectl logs <pod-name> -n <namespace> --previous   # logs from last crash
```

Common causes:
- Wrong MONGO_URI — check the base64 decode: `kubectl get secret auth-secret -n services -o jsonpath='{.data.MONGO_URI}' | base64 -d`
- Image not found — did you run `eval $(minikube docker-env)` before building?
- Port mismatch — container port vs app listening port

### ImagePullBackOff

```bash
kubectl describe pod <pod-name> -n <namespace>
```

Means K8s tried to pull from Docker Hub and failed. Fix:
- You forgot `eval $(minikube docker-env)` before building — the image exists in your local Docker, not Minikube's
- `imagePullPolicy` is not `Never` — add it to the Deployment

### Service not reachable

```bash
# Check if endpoints are populated — if empty, selector doesn't match pod labels
kubectl get endpoints <service-name> -n <namespace>

# Check pod labels
kubectl get pod <pod-name> -n <namespace> --show-labels

# Cross-namespace test — exec into a pod and curl
kubectl exec -it <pod-name> -n services -- wget -qO- http://auth-service:3001/api/auth/health
kubectl exec -it <pod-name> -n services -- wget -qO- http://mongodb-service.database.svc.cluster.local:27017
```

### Wrong or missing env var

```bash
# See all env vars injected into a running container
kubectl exec -it <pod-name> -n services -- env | grep MONGO
kubectl exec -it <pod-name> -n services -- env | grep PORT
```

### Ingress returning 404

```bash
kubectl describe ingress app-ingress -n services
# Check that paths are correct and backend service names match exactly
kubectl get services -n services
```

### Useful one-liners

```bash
# Get all resources in a namespace at once
kubectl get all -n services
kubectl get all -n database

# Delete and redeploy a single service (after fixing something)
kubectl delete deployment auth-deployment -n services
kubectl apply -f k8s/auth/deployment.yaml

# Stream logs from a pod
kubectl logs -f <pod-name> -n services

# Get pod name quickly
kubectl get pod -n services -l app=auth-service -o name

# Check which node a pod landed on
kubectl get pods -n services -o wide
```

---

---

## Phase 8 — MongoDB HA with StatefulSet (3-Node Replica Set)

### Why HA and why StatefulSet

A regular Deployment is fine for stateless apps but breaks for MongoDB because:
- Pods get random names (`mongodb-abc123`) — changes on every restart
- MongoDB replica set members identify each other by hostname — random names break this
- Multiple replicas would each try to write to different data, causing split-brain

**StatefulSet** solves all of this:
- Pods get fixed, ordered names: `mongodb-0`, `mongodb-1`, `mongodb-2`
- Names survive restarts and rescheduling
- Each pod gets its own dedicated PVC (via `volumeClaimTemplates`)
- Pods start in order: 0 → 1 → 2

---

### Why 3 nodes and no Arbiter

MongoDB replica sets need a **majority vote** to elect a Primary. Majority = more than half.

```
2-node setup:
  node-0 (PRIMARY) dies
  node-1 alone = 1 vote out of 2 total = NOT majority → no election → cluster STALLS
  → Need arbiter (voting-only node, no data) to break the tie

3-node setup:
  node-0 (PRIMARY) dies
  node-1 + node-2 = 2 votes out of 3 total = majority → election happens → NEW PRIMARY elected
  → No arbiter needed
```

With 3 data nodes you get:
- Majority voting built in
- Full data redundancy on all 3 nodes
- Automatic failover with zero manual intervention

---

### Deployment vs StatefulSet — key differences

| Feature | Deployment | StatefulSet |
|---------|-----------|-------------|
| Pod names | Random (`pod-abc123`) | Ordered (`pod-0`, `pod-1`, `pod-2`) |
| Storage | Shared or none | Each pod gets its own PVC |
| Startup order | All at once | Ordered (0 → 1 → 2) |
| Use case | Stateless apps | Databases, queues |
| DNS per pod | No | Yes (via headless service) |

---

### Headless Service — what it is and why MongoDB needs it

A normal Service gets a single ClusterIP and load-balances across pods. You cannot reach individual pods by name.

A **Headless Service** (`clusterIP: None`) skips the load balancer. Instead, DNS returns the IP of each individual pod directly.

This gives every StatefulSet pod a stable DNS name:
```
<pod-name>.<headless-service-name>.<namespace>.svc.cluster.local
```

For our MongoDB:
```
mongodb-0.mongodb-headless.database.svc.cluster.local:27017
mongodb-1.mongodb-headless.database.svc.cluster.local:27017
mongodb-2.mongodb-headless.database.svc.cluster.local:27017
```

MongoDB replica set members use these exact DNS names to find each other. Without a headless service, pods cannot resolve each other by name and the replica set cannot form.

---

### Architecture flow

```
Application (services namespace)
        │
        │  MONGO_URI with all 3 hosts + replicaSet=rs0
        ▼
mongodb-headless Service (clusterIP: None)
        │
        ├──► mongodb-0.mongodb-headless.database.svc.cluster.local
        │         └── /data/db → pvc-mongodb-0 (dedicated PVC)
        │
        ├──► mongodb-1.mongodb-headless.database.svc.cluster.local
        │         └── /data/db → pvc-mongodb-1 (dedicated PVC)
        │
        └──► mongodb-2.mongodb-headless.database.svc.cluster.local
                  └── /data/db → pvc-mongodb-2 (dedicated PVC)

mongodb-0 = PRIMARY  (handles all writes)
mongodb-1 = SECONDARY (replicates from primary, can serve reads)
mongodb-2 = SECONDARY (replicates from primary, can serve reads)

If mongodb-0 dies:
  mongodb-1 + mongodb-2 vote → one becomes new PRIMARY → app reconnects automatically
```

---

### volumeClaimTemplates — how each pod gets its own PVC

In a regular Deployment you define a `volumes` block pointing to one PVC. With StatefulSet you use `volumeClaimTemplates` — K8s automatically creates a unique PVC for each pod.

```yaml
volumeClaimTemplates:
  - metadata:
      name: mongodb-data           # this becomes the volume name inside the pod
    spec:
      accessModes: [ReadWriteOnce]
      storageClassName: standard
      resources:
        requests:
          storage: 1Gi
```

This creates:
```
mongodb-data-mongodb-0   ← PVC for pod mongodb-0
mongodb-data-mongodb-1   ← PVC for pod mongodb-1
mongodb-data-mongodb-2   ← PVC for pod mongodb-2
```

Pattern: `<volumeClaimTemplate.name>-<pod-name>`

---

### How `--replSet rs0` works

When MongoDB starts with `--replSet rs0`, it does NOT automatically join a replica set. It starts in standalone mode waiting for initialization.

You must manually run `rs.initiate()` ONCE after all 3 pods are Running. This tells `mongodb-0` who the members are and bootstraps the replica set.

---

### YAML Files

**Headless Service:**

```yaml
# k8s/mongodb/service-headless.yaml
apiVersion: v1
kind: Service
metadata:
  name: mongodb-headless
  namespace: database
spec:
  clusterIP: None                  # this is what makes it headless
  selector:
    app: mongodb
  ports:
    - port: 27017
      targetPort: 27017
```

**Regular Service (for app connections):**

Keep the regular ClusterIP service too — apps use this as a stable entry point. MongoDB driver with `replicaSet=rs0` in the URI automatically discovers all members but needs an initial host to connect to.

```yaml
# k8s/mongodb/service.yaml
apiVersion: v1
kind: Service
metadata:
  name: mongodb-service
  namespace: database
spec:
  type: ClusterIP
  selector:
    app: mongodb
  ports:
    - port: 27017
      targetPort: 27017
```

**StatefulSet:**

```yaml
# k8s/mongodb/statefulset.yaml
apiVersion: apps/v1
kind: StatefulSet
metadata:
  name: mongodb
  namespace: database
spec:
  serviceName: mongodb-headless      # must match the headless service name
  replicas: 3
  selector:
    matchLabels:
      app: mongodb
  template:
    metadata:
      labels:
        app: mongodb
    spec:
      containers:
        - name: mongodb
          image: mongo:6.0
          imagePullPolicy: IfNotPresent
          command:
            - mongod
            - "--replSet"
            - "rs0"
            - "--bind_ip_all"
          ports:
            - containerPort: 27017
          env:
            - name: MONGO_INITDB_ROOT_USERNAME
              valueFrom:
                secretKeyRef:
                  name: mongodb-secret
                  key: MONGO_ROOT_USERNAME
            - name: MONGO_INITDB_ROOT_PASSWORD
              valueFrom:
                secretKeyRef:
                  name: mongodb-secret
                  key: MONGO_ROOT_PASSWORD
          volumeMounts:
            - name: mongodb-data
              mountPath: /data/db
  volumeClaimTemplates:
    - metadata:
        name: mongodb-data
      spec:
        accessModes: [ReadWriteOnce]
        storageClassName: standard
        resources:
          requests:
            storage: 1Gi
```

**Key difference from Deployment:** `volumeClaimTemplates` is at the same level as `template`, NOT inside `spec.template.spec`. StatefulSet manages PVC creation itself.

---

### Bootstrapping the Replica Set (rs.initiate)

After all 3 pods are Running, exec into `mongodb-0` and initialize:

```bash
# Wait for all 3 pods to be Running
kubectl get pods -n database -w

# Exec into mongodb-0
kubectl exec -it mongodb-0 -n database -- mongosh -u admin -p password123 --authenticationDatabase admin

# Inside mongosh — run this ONCE
rs.initiate({
  _id: "rs0",
  members: [
    { _id: 0, host: "mongodb-0.mongodb-headless.database.svc.cluster.local:27017" },
    { _id: 1, host: "mongodb-1.mongodb-headless.database.svc.cluster.local:27017" },
    { _id: 2, host: "mongodb-2.mongodb-headless.database.svc.cluster.local:27017" }
  ]
})
```

Expected output: `{ ok: 1 }`

Then check replica set status:
```bash
rs.status()
```

You will see one PRIMARY and two SECONDARYs.

---

### Updated Secrets for HA MONGO_URI

The connection string now lists all 3 hosts and includes `replicaSet=rs0`:

```
mongodb://admin:password123@mongodb-0.mongodb-headless.database.svc.cluster.local:27017,mongodb-1.mongodb-headless.database.svc.cluster.local:27017,mongodb-2.mongodb-headless.database.svc.cluster.local:27017/<dbname>?authSource=admin&replicaSet=rs0&readPreference=primaryPreferred
```

- **All 3 hosts listed** — if one is down, driver tries the others to bootstrap
- **`replicaSet=rs0`** — tells the driver this is a replica set, enables automatic failover
- **`readPreference=primaryPreferred`** — writes always go to PRIMARY, reads prefer PRIMARY but fall back to SECONDARY if primary is down

**Updated auth secret:**

```yaml
# k8s/auth/secret.yaml
apiVersion: v1
kind: Secret
metadata:
  name: auth-secret
  namespace: services
type: Opaque
data:
  # mongodb://admin:password123@mongodb-0.mongodb-headless.database.svc.cluster.local:27017,mongodb-1...27017,mongodb-2...27017/authdb?authSource=admin&replicaSet=rs0&readPreference=primaryPreferred
  MONGO_URI: bW9uZ29kYjovL2FkbWluOnBhc3N3b3JkMTIzQG1vbmdvZGItMC5tb25nb2RiLWhlYWRsZXNzLmRhdGFiYXNlLnN2Yy5jbHVzdGVyLmxvY2FsOjI3MDE3LG1vbmdvZGItMS5tb25nb2RiLWhlYWRsZXNzLmRhdGFiYXNlLnN2Yy5jbHVzdGVyLmxvY2FsOjI3MDE3LG1vbmdvZGItMi5tb25nb2RiLWhlYWRsZXNzLmRhdGFiYXNlLnN2Yy5jbHVzdGVyLmxvY2FsOjI3MDE3L2F1dGhkYj9hdXRoU291cmNlPWFkbWluJnJlcGxpY2FTZXQ9cnMwJnJlYWRQcmVmZXJlbmNlPXByaW1hcnlQcmVmZXJyZWQ=
  # your own value from: openssl rand -base64 32 | then base64 encode it
  JWT_SECRET: <your-base64-encoded-jwt-secret>
```

**Updated payment secret:**

```yaml
# k8s/payment/secret.yaml
apiVersion: v1
kind: Secret
metadata:
  name: payment-secret
  namespace: services
type: Opaque
data:
  MONGO_URI: bW9uZ29kYjovL2FkbWluOnBhc3N3b3JkMTIzQG1vbmdvZGItMC5tb25nb2RiLWhlYWRsZXNzLmRhdGFiYXNlLnN2Yy5jbHVzdGVyLmxvY2FsOjI3MDE3LG1vbmdvZGItMS5tb25nb2RiLWhlYWRsZXNzLmRhdGFiYXNlLnN2Yy5jbHVzdGVyLmxvY2FsOjI3MDE3LG1vbmdvZGItMi5tb25nb2RiLWhlYWRsZXNzLmRhdGFiYXNlLnN2Yy5jbHVzdGVyLmxvY2FsOjI3MDE3L3BheW1lbnRkYj9hdXRoU291cmNlPWFkbWluJnJlcGxpY2FTZXQ9cnMwJnJlYWRQcmVmZXJlbmNlPXByaW1hcnlQcmVmZXJyZWQ=
```

**Updated notification secret:**

```yaml
# k8s/notification/secret.yaml
apiVersion: v1
kind: Secret
metadata:
  name: notification-secret
  namespace: services
type: Opaque
data:
  MONGO_URI: bW9uZ29kYjovL2FkbWluOnBhc3N3b3JkMTIzQG1vbmdvZGItMC5tb25nb2RiLWhlYWRsZXNzLmRhdGFiYXNlLnN2Yy5jbHVzdGVyLmxvY2FsOjI3MDE3LG1vbmdvZGItMS5tb25nb2RiLWhlYWRsZXNzLmRhdGFiYXNlLnN2Yy5jbHVzdGVyLmxvY2FsOjI3MDE3LG1vbmdvZGItMi5tb25nb2RiLWhlYWRsZXNzLmRhdGFiYXNlLnN2Yy5jbHVzdGVyLmxvY2FsOjI3MDE3L25vdGlmaWNhdGlvbmRiP2F1dGhTb3VyY2U9YWRtaW4mcmVwbGljYVNldD1yczAmcmVhZFByZWZlcmVuY2U9cHJpbWFyeVByZWZlcnJlZA==
```

---

### HA Deploy Order

```bash
# Step 1 — namespaces (same as before)
kubectl apply -f k8s/namespace/namespaces.yaml

# Step 2 — MongoDB secrets and headless service first
kubectl apply -f k8s/mongodb/secret.yaml
kubectl apply -f k8s/mongodb/service-headless.yaml
kubectl apply -f k8s/mongodb/service.yaml

# Step 3 — StatefulSet (no PVC needed separately — volumeClaimTemplates handles it)
kubectl apply -f k8s/mongodb/statefulset.yaml

# Watch pods come up in ORDER — 0 first, then 1, then 2
kubectl get pods -n database -w

# Step 4 — Once ALL 3 are Running, initialize the replica set
kubectl exec -it mongodb-0 -n database -- mongosh -u admin -p password123 --authenticationDatabase admin --eval '
rs.initiate({
  _id: "rs0",
  members: [
    { _id: 0, host: "mongodb-0.mongodb-headless.database.svc.cluster.local:27017" },
    { _id: 1, host: "mongodb-1.mongodb-headless.database.svc.cluster.local:27017" },
    { _id: 2, host: "mongodb-2.mongodb-headless.database.svc.cluster.local:27017" }
  ]
})'

# Step 5 — Verify replica set
kubectl exec -it mongodb-0 -n database -- mongosh -u admin -p password123 --authenticationDatabase admin --eval 'rs.status().members.forEach(m => print(m.name, m.stateStr))'

# Step 6 — Continue with auth, notification, payment, frontend, ingress
# (same as Phase 7 deploy order)
```

---

### Verify HA is working — chaos test

```bash
# Check which pod is PRIMARY
kubectl exec -it mongodb-0 -n database -- mongosh -u admin -p password123 --authenticationDatabase admin --eval 'rs.isMaster().primary'

# Kill the PRIMARY pod
kubectl delete pod mongodb-0 -n database

# Watch — StatefulSet recreates mongodb-0 immediately
kubectl get pods -n database -w

# Check new PRIMARY (should be mongodb-1 or mongodb-2 now)
kubectl exec -it mongodb-1 -n database -- mongosh -u admin -p password123 --authenticationDatabase admin --eval 'rs.isMaster().primary'

# mongodb-0 rejoins as SECONDARY after it restarts
kubectl exec -it mongodb-0 -n database -- mongosh -u admin -p password123 --authenticationDatabase admin --eval 'rs.isMaster().ismaster'
```

---

### HA Troubleshooting

**Pods stuck in Pending:**
```bash
kubectl describe pod mongodb-1 -n database
# Check if PVCs were created
kubectl get pvc -n database
# You should see: mongodb-data-mongodb-0, mongodb-data-mongodb-1, mongodb-data-mongodb-2
```

**Replica set not forming:**
```bash
# Check if headless service DNS resolves from inside a pod
kubectl exec -it mongodb-0 -n database -- nslookup mongodb-1.mongodb-headless.database.svc.cluster.local
# If this fails, headless service selector doesn't match pod labels
```

**rs.initiate() fails with "already initialized":**
```bash
# Just check status — it may have already worked
kubectl exec -it mongodb-0 -n database -- mongosh -u admin -p password123 --authenticationDatabase admin --eval 'rs.status()'
```

**App cannot connect after HA setup:**
```bash
# Decode your secret and verify the URI has replicaSet=rs0
kubectl get secret auth-secret -n services -o jsonpath='{.data.MONGO_URI}' | base64 -d
```

---

## Key Rules to Never Forget

| Rule | Why |
|------|-----|
| Secret values must be base64 encoded with `echo -n` | Trailing newline breaks connections silently |
| Secret namespace must match the pod using it | K8s cannot reference secrets across namespaces |
| `imagePullPolicy: Never` for all local images | Without it, K8s tries Docker Hub and fails |
| Run `eval $(minikube docker-env)` before every build | Without it, images go to host Docker not Minikube |
| Service `metadata.name` = DNS hostname | Name it `auth-service` and it's reachable at `auth-service` |
| Deployment `selector.matchLabels` must match Pod `template.metadata.labels` | Mismatch = deployment creates pods it can never manage |
| Ingress specific paths before catch-all `/` | NGINX matches top to bottom |
| Cross-namespace DNS = `<service>.<namespace>.svc.cluster.local` | Short names only work within the same namespace |
