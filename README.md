# K8s YAML Mastery — Learn by Building

## How This Guide Works

Each section follows the same pattern:
1. **Concept** — what this resource is and why it exists
2. **Fields explained** — every field with 3 questions: kya hai, kyun hai, remove karo toh kya tutega
3. **Try it yourself** — write it from scratch first
4. **Solution** — the actual YAML with inline comments explaining every line
5. **Verify** — commands to confirm it worked

Do NOT skip to the solution. Write it yourself first. The struggle is where learning happens.

---

## Architecture — Two Namespaces, One App

```
Namespace: database          Namespace: services
┌──────────────────┐         ┌─────────────────────────────────────────┐
│                  │         │                                         │
│   MongoDB        │◄────────│  auth-service                           │
│   (StatefulSet)  │◄────────│  payment-service                        │
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
http://auth-service.services.svc.cluster.local:3001
```

The pattern is always:
```
<service-name>.<namespace>.svc.cluster.local:<port>
```

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

auth-service         ──► MongoDB replica set (authdb)
payment-service      ──► MongoDB replica set (paymentdb)
notification-service ──► MongoDB replica set (notificationdb)
```

**How services actually reach MongoDB — MONGO_URI explained:**

Each service's secret has a `MONGO_URI` that lists all 3 MongoDB pod addresses:

```
mongodb://admin:password123@
  mongodb-0.mongodb-headless.database.svc.cluster.local:27017,
  mongodb-1.mongodb-headless.database.svc.cluster.local:27017,
  mongodb-2.mongodb-headless.database.svc.cluster.local:27017
/authdb?authSource=admin&replicaSet=rs0
```

This URI has 4 important parts:

**1. All 3 hosts listed (seed list)**

These 3 addresses are called the **seed list** — they are just starting points. The driver does not connect to all 3 for every request. It uses them to find the replica set:

```
App starts → tries mongodb-0 → connected ✅
App starts → mongodb-0 is down → tries mongodb-1 → connected ✅
App starts → mongodb-0, mongodb-1 both down → tries mongodb-2 → connected ✅
```

If only 1 host was listed and that pod was down at startup → app cannot connect at all.

**2. `replicaSet=rs0`**

This tells the MongoDB driver: "these hosts are part of a replica set named rs0."

Without this flag, the driver treats each host as a standalone server — it would not know about elections, would not do automatic failover, and would not discover the PRIMARY.

With this flag:
```
Driver connects to any seed host
       ↓
Asks: "Who is the current PRIMARY in rs0?"
       ↓
Gets answer: "mongodb-0 is PRIMARY right now"
       ↓
All writes go to mongodb-0

mongodb-0 crashes:
       ↓
Driver detects connection failure
       ↓
Asks mongodb-1: "Who is PRIMARY now?"
       ↓
mongodb-1: "I am PRIMARY now"
       ↓
Driver switches — all writes now go to mongodb-1
Your app did not restart, no code changed, no manual intervention
```

**3. `authSource=admin`**

MongoDB creates the root user in the `admin` database. Even though the app connects to `authdb`, it authenticates against `admin`. This tells the driver where to look for credentials.

**4. Database name in the URI (`/authdb`)**

Each service connects to its own database — `authdb`, `paymentdb`, `notificationdb`. All 3 live inside the same MongoDB replica set but are completely isolated from each other.

### File structure you will build

```
K8s/
├── namespaces/
│   └── namespaces.yaml
├── mongodb/
│   ├── secret.yaml
│   ├── configmap.yaml
│   ├── service-headless.yaml
│   └── statefulset.yaml
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

## Phase 0 — Universal YAML Anatomy (read this before writing any YAML)

No files to create in this phase. Just understanding.

---

### What is YAML

YAML is just a way to write structured data using indentation. Kubernetes reads your YAML files and creates resources based on them.

Two things matter:
- **Indentation** — use 2 spaces (never tabs). Wrong indentation = broken YAML.
- **Structure** — Kubernetes expects specific field names in specific places.

---

### The 4 blocks every K8s resource has

Every single Kubernetes resource — whether it is a Secret, a Deployment, an Ingress, or anything else — has the same 4 top-level blocks:

```yaml
apiVersion: ...    # Block 1 — which API handles this
kind: ...          # Block 2 — what type of resource
metadata:          # Block 3 — identity
  name: ...
  namespace: ...
spec:              # Block 4 — desired state (what you want)
  ...
```

Memorise this skeleton. You will write it hundreds of times.

---

### Block 1 — `apiVersion`

**Kya hai?**
The Kubernetes API is divided into groups. `apiVersion` tells K8s which group and version handles this resource type.

**Kyun hai?**
Different resource types are maintained by different teams inside Kubernetes and versioned independently. You must tell K8s which API to send your request to.

**Remove karo toh?**
`kubectl apply` will throw a validation error immediately — it cannot process the YAML without knowing which API to use.

**Values you will use:**

| apiVersion | Resources it handles |
|------------|---------------------|
| `v1` | Pod, Service, Secret, ConfigMap, Namespace, PersistentVolumeClaim |
| `apps/v1` | Deployment, StatefulSet, DaemonSet |
| `networking.k8s.io/v1` | Ingress |

The `v1` resources are "core" — they existed from the very beginning. The `apps/v1` resources were added later and grouped under `apps`. The pattern `group/version` is how you read it.

---

### Block 2 — `kind`

**Kya hai?**
The exact type of resource you want to create.

**Kyun hai?**
Even within the same `apiVersion`, there are multiple resource types. `kind` tells Kubernetes exactly what to create.

**Remove karo toh?**
`kubectl apply` will fail immediately — required field.

**Mismatch karo toh?**
`apiVersion: v1` + `kind: Deployment` → error. Deployment lives in `apps/v1`, not `v1`.

---

### Block 3 — `metadata`

**Kya hai?**
Identity of the resource. Three fields you will always use:

```yaml
metadata:
  name: auth-service        # What this resource is called
  namespace: services       # Which namespace it belongs to
  labels:                   # Key-value tags for selecting/grouping
    app: auth-service
```

**`metadata.name`**
- Kya hai: The name Kubernetes uses to identify this resource.
- Kyun hai: Every resource must have a unique name within its namespace and kind. Also, for Services, this name becomes the DNS hostname.
- Remove karo toh: `kubectl apply` fails — required field.

**`metadata.namespace`**
- Kya hai: Which namespace bucket this resource lives in.
- Kyun hai: Namespaces are isolation boundaries. A Secret in `database` namespace can only be used by pods in `database` namespace.
- Remove karo toh: Resource goes into `default` namespace — your pods in `services` or `database` namespace cannot find it.

**`metadata.labels`**
- Kya hai: Arbitrary key-value tags you attach to a resource.
- Kyun hai: Services and Deployments use labels to find their pods. Without matching labels, nothing connects.
- Remove karo toh: The resource exists but nothing can select it — Deployments won't manage its pods, Services won't route traffic to it.

---

### Block 4 — `spec`

**Kya hai?**
Your desired state declaration. "I want X to look like this."

**Kyun hai?**
Kubernetes is declarative — you describe what you want, not how to get there. `spec` is where you describe it. Kubernetes continuously reconciles reality to match your `spec`.

**Remove karo toh?**
For most resources, `kubectl apply` will fail. For some it may apply but do nothing.

**Why some resources use `data` instead of `spec`:**

Secret and ConfigMap are pure storage — they don't have a "desired state" in the Kubernetes sense. They just hold data. So they use a `data` block instead of `spec`:

```yaml
# Secret and ConfigMap — no spec, just data
kind: Secret
data:
  SOME_KEY: base64value

# Everything else — uses spec
kind: Deployment
spec:
  replicas: 1
  ...
```

---

### The full picture — how blocks connect

```
apiVersion: apps/v1        You are talking to the 'apps' API group
kind: Deployment           Create a Deployment object
metadata:
  name: auth-deployment    Call it 'auth-deployment'
  namespace: services      Put it in the 'services' namespace
  labels:
    app: auth-service      Tag it with app=auth-service
spec:                      Here is what I want:
  replicas: 1              Run 1 copy
  selector:
    matchLabels:
      app: auth-service    Manage pods tagged with app=auth-service
  template:                Each pod should look like this:
    metadata:
      labels:
        app: auth-service  Tag the pod too (MUST match selector above)
    spec:
      containers:
        - name: auth-service
          image: auth-service:v1
```

`spec.selector.matchLabels` and `spec.template.metadata.labels` must be identical — this is how the Deployment knows which pods are "its" pods. Mismatch here = pods that run but are never managed, never scaled, never replaced on crash.

---

### Labels and Selectors

This is one of the most important concepts in Kubernetes. Everything connects through labels.

**Label kya hai?**

A label is a key-value tag you stick on any resource:

```yaml
metadata:
  labels:
    app: auth-service      # key=app, value=auth-service
    env: production        # key=env, value=production
    version: v1            # key=version, value=v1
```

Labels have no meaning to Kubernetes itself — they are just tags YOU define. Their value comes from selectors.

**Selector kya hai?**

A selector is a filter — "give me all resources that have THIS label."

```yaml
selector:
  matchLabels:
    app: auth-service    # Find everything tagged app=auth-service
```

**How they wire everything together:**

```
You create pods via Deployment (pods get label app=auth-service)
                    ↓
Service says: selector: app=auth-service
                    ↓
Service finds those pods and routes traffic to them
                    ↓
Deployment also says: selector.matchLabels: app=auth-service
                    ↓
Deployment watches those pods — if one dies, it creates a replacement
```

Three things share the SAME label value:

```
Deployment.spec.selector.matchLabels.app    = auth-service  ← "I manage pods with this label"
Pod.metadata.labels.app                     = auth-service  ← "I am this pod"
Service.spec.selector.app                   = auth-service  ← "I route to pods with this label"
```

**What breaks if labels mismatch:**

```
Deployment selector: app=auth-service
Pod label:           app=auth-backend      ← DIFFERENT

Result:
- Deployment creates pods (because template says app=auth-backend)
- Deployment never "sees" those pods (selector looks for app=auth-service)
- Deployment keeps creating more pods thinking none are running
- Orphan pods pile up — no management, no restart on crash
```

```
Service selector:    app=auth-service
Pod label:           app=auth-backend      ← DIFFERENT

Result:
- Service exists and has a DNS name
- kubectl get endpoints auth-service → shows NO endpoints
- All traffic to auth-service gets dropped
- payment-service gets connection refused when calling auth
```

**Labels can be anything — these are conventions we follow:**

```yaml
labels:
  app: auth-service       # what application is this
  version: v1             # which version
  tier: backend           # frontend / backend / database
```

You only need `app` for this project. The others are optional conventions.

---

### Resources — CPU and Memory

By default, a pod can use ALL available CPU and memory on the node. In production this is dangerous — one bad pod can starve all others. Kubernetes lets you set limits.

**Two settings per container:**

```yaml
resources:
  requests:         # Minimum guaranteed — Kubernetes reserves this on the node
    cpu: "100m"     # 100 millicores = 0.1 CPU core
    memory: "128Mi" # 128 Mebibytes
  limits:           # Maximum allowed — container is killed if it exceeds this
    cpu: "500m"     # 500 millicores = 0.5 CPU core
    memory: "256Mi" # 256 Mebibytes
```

**CPU units:**

```
1000m  = 1 full CPU core
500m   = half a CPU core
100m   = 1/10 of a CPU core (one hundred millicores)
```

CPU is throttled when limit is hit — container slows down but does NOT crash.

**Memory units:**

```
Mi  = Mebibytes  (1 Mi = 1,048,576 bytes) ← use this
Gi  = Gibibytes  (1 Gi = 1,073,741,824 bytes)
M   = Megabytes  (1 M  = 1,000,000 bytes)
```

Memory is NOT throttled when limit is hit — container is **killed** (OOMKilled). It restarts.

**requests vs limits:**

```
requests = what Kubernetes RESERVES on the node for you
           Used for scheduling — node must have this much free

limits   = maximum your container can USE
           CPU: throttled if exceeded
           Memory: killed if exceeded
```

**Example — what happens at scheduling:**

```
Node has 2 CPU cores, 4Gi memory available

Pod A requests: cpu=500m, memory=1Gi   → scheduled, node now has 1.5 CPU, 3Gi free
Pod B requests: cpu=500m, memory=1Gi   → scheduled, node now has 1 CPU, 2Gi free
Pod C requests: cpu=500m, memory=1Gi   → scheduled, node now has 0.5 CPU, 1Gi free
Pod D requests: cpu=1000m, memory=2Gi  → NOT scheduled — not enough reserved capacity
```

**For this learning project we don't set resources** — Minikube is a single-node local cluster and we have no resource contention. In production you always set them.

If you want to add them for practice:

```yaml
containers:
  - name: auth-service
    image: auth-service:v1
    resources:
      requests:
        cpu: "100m"
        memory: "128Mi"
      limits:
        cpu: "300m"
        memory: "256Mi"
```

---

## Phase 1 — Namespaces

### Concept

A Namespace is a logical partition inside your cluster. Every resource lives inside a namespace. If you don't specify one, resources go into `default`.

Think of namespaces like separate folders — resources in one namespace don't conflict with resources in another, even if they have the same name.

### Fields explained

```yaml
apiVersion: v1
kind: Namespace
metadata:
  name: database
```

**Why Namespace has no `spec`:**
A Namespace is just a container — it has no desired state beyond "exist." So there is nothing to put in `spec`. It is one of the few K8s resources with only `metadata`.

| Field | Kya hai | Kyun hai | Remove karo toh |
|-------|---------|----------|-----------------|
| `apiVersion: v1` | Namespace lives in core API | Core resources use v1 | Apply fails |
| `kind: Namespace` | Create a namespace | Tells K8s what to make | Apply fails |
| `metadata.name` | Name of the namespace | Referenced everywhere else | Apply fails |

The `---` separator lets you put multiple resources in one file.

### Try it yourself

Create `K8s/namespaces/namespaces.yaml` with two namespaces: `database` and `services`.

### Solution

```yaml
# K8s/namespaces/namespaces.yaml
apiVersion: v1
kind: Namespace
metadata:
  name: database    # All MongoDB resources go here
---
apiVersion: v1
kind: Namespace
metadata:
  name: services    # All app services go here
```

### Verify

```bash
kubectl apply -f K8s/namespaces/namespaces.yaml
kubectl get namespaces
```

Expected:
```
database   Active
services   Active
```

---

## Phase 2 — MongoDB

MongoDB needs 4 files in this order: secret → configmap → service-headless → statefulset.

All 4 go in `K8s/mongodb/`.

---

### 2.1 — Secret

#### Concept

A Secret stores sensitive data — passwords, tokens, connection strings. Values are base64 encoded (NOT encrypted — just encoded for safe storage).

**Why base64?**
Kubernetes stores everything as JSON internally. Base64 ensures binary-safe storage — special characters like `@`, `/`, `?` in a MongoDB URI cannot break the JSON structure when encoded.

**Important:** A Secret in `database` namespace can ONLY be read by pods in `database` namespace. Cross-namespace secret access is not allowed in Kubernetes.

#### How to generate base64 values

```bash
echo -n "your-value-here" | base64
```

The `-n` flag is critical — it prevents a trailing newline. Without it, your decoded secret will have a hidden `\n` at the end and connections will silently fail.

To decode and verify:
```bash
echo "YWRtaW4=" | base64 -d
```

#### Fields explained

```yaml
apiVersion: v1
kind: Secret
metadata:
  name: mongodb-secret
  namespace: database
type: Opaque
data:
  MONGO_ROOT_USERNAME: YWRtaW4=
  MONGO_ROOT_PASSWORD: cGFzc3dvcmQxMjM=
```

| Field | Kya hai | Kyun hai | Remove karo toh |
|-------|---------|----------|-----------------|
| `apiVersion: v1` | Secret is a core resource | Secrets predate the apps group | Apply fails |
| `kind: Secret` | Create a Secret object | — | Apply fails |
| `metadata.name` | Name used to reference this secret in pods | `secretKeyRef.name` must match this | Pod cannot find the secret → CrashLoopBackOff |
| `metadata.namespace: database` | Secret lives in database namespace | MongoDB StatefulSet is in database namespace — it needs to read from same namespace | StatefulSet cannot find secret → pods stay Pending |
| `type: Opaque` | "Generic secret, arbitrary key-value pairs" | Other types (kubernetes.io/tls, kubernetes.io/dockerconfigjson) have specific structure. Opaque means no structure enforced | Defaults to Opaque if omitted — but always write it explicitly |
| `data` | The actual stored values | Key = env var name, Value = base64 encoded content | Required — nothing to store without it |
| key inside `data` | Env var name the pod will receive | Must match exactly what your app reads via `process.env.KEY` | App gets undefined, crashes |

**Why `data` not `spec`?**
A Secret is pure storage — it does not have a "desired state." It just holds values. Kubernetes uses `data` for this instead of `spec`.

#### Try it yourself

MongoDB needs:
- `MONGO_ROOT_USERNAME` = admin
- `MONGO_ROOT_PASSWORD` = password123

#### Solution

```yaml
# K8s/mongodb/secret.yaml
apiVersion: v1
kind: Secret
metadata:
  name: mongodb-secret    # StatefulSet will reference this name
  namespace: database     # Same namespace as the StatefulSet
type: Opaque              # Generic key-value secret
data:
  MONGO_ROOT_USERNAME: YWRtaW4=          # "admin" base64 encoded
  MONGO_ROOT_PASSWORD: cGFzc3dvcmQxMjM=  # "password123" base64 encoded
```

#### Verify

```bash
kubectl apply -f K8s/mongodb/secret.yaml
kubectl get secrets -n database
# Decode to confirm value is correct
kubectl get secret mongodb-secret -n database -o jsonpath='{.data.MONGO_ROOT_USERNAME}' | base64 -d
```

---

### 2.2 — ConfigMap

#### Concept

A ConfigMap stores non-sensitive configuration — port numbers, URLs, feature flags. Unlike Secrets, values are plain text (no base64).

Rule of thumb:
- Password, token, connection string → **Secret**
- Port number, URL, feature flag → **ConfigMap**

**Note:** MongoDB itself does not read from this ConfigMap — the StatefulSet reads credentials from the Secret only. This ConfigMap is here to practice the concept before you write configmaps for auth, payment, and notification services where it IS actively used.

#### Fields explained

```yaml
apiVersion: v1
kind: ConfigMap
metadata:
  name: mongodb-config
  namespace: database
data:
  MONGO_HOST: "mongodb-headless.database.svc.cluster.local"
  MONGO_PORT: "27017"
```

| Field | Kya hai | Kyun hai | Remove karo toh |
|-------|---------|----------|-----------------|
| `apiVersion: v1` | ConfigMap is a core resource | — | Apply fails |
| `kind: ConfigMap` | Create a ConfigMap object | — | Apply fails |
| `metadata.name` | Name used to reference this configmap | `configMapRef.name` must match | Pod cannot find configmap → CrashLoopBackOff |
| `metadata.namespace` | ConfigMap lives in this namespace | Pod must be in same namespace to use it | Pod cannot find it |
| `data` | Plain text key-value pairs | Key = env var name, Value = plain string | Nothing to store |
| Values wrapped in quotes | `"27017"` not `27017` | YAML treats unquoted numbers as integers. Kubernetes env vars must be strings. Without quotes, port becomes integer type and may cause type errors | Potential type mismatch |

**Why `data` not `spec`?** Same reason as Secret — ConfigMap is pure storage, not a desired state declaration.

#### Try it yourself

Create `K8s/mongodb/configmap.yaml` with:
- `MONGO_HOST` = mongodb-headless.database.svc.cluster.local
- `MONGO_PORT` = 27017

#### Solution

```yaml
# K8s/mongodb/configmap.yaml
apiVersion: v1
kind: ConfigMap
metadata:
  name: mongodb-config
  namespace: database
data:
  MONGO_HOST: "mongodb-headless.database.svc.cluster.local"
  MONGO_PORT: "27017"    # Always quote numbers — env vars must be strings
```

#### Verify

```bash
kubectl apply -f K8s/mongodb/configmap.yaml
kubectl get configmaps -n database
kubectl describe configmap mongodb-config -n database
```

---

### 2.3 — StatefulSet + Headless Service

#### Why StatefulSet instead of Deployment

A regular Deployment breaks for MongoDB because:
- Pods get random names (`mongodb-abc123`) — changes on every restart
- MongoDB replica set members identify each other by hostname — random names break this
- Multiple replicas would each try to write to different data, causing split-brain

**StatefulSet** solves all of this:
- Pods get fixed, ordered names: `mongodb-0`, `mongodb-1`, `mongodb-2`
- Names survive restarts and rescheduling
- Each pod gets its own dedicated PVC (via `volumeClaimTemplates`)
- Pods start in order: 0 → 1 → 2

---

#### Why 3 nodes and no Arbiter

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

#### Deployment vs StatefulSet — key differences

| Feature | Deployment | StatefulSet |
|---------|-----------|-------------|
| Pod names | Random (`pod-abc123`) | Ordered (`pod-0`, `pod-1`, `pod-2`) |
| Storage | Shared or none | Each pod gets its own PVC |
| Startup order | All at once | Ordered (0 → 1 → 2) |
| Use case | Stateless apps | Databases, queues |
| DNS per pod | No | Yes (via headless service) |

---

#### Headless Service — what it is and why MongoDB needs it

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

#### How the 3 nodes connect to each other

**Step 1 — rs.initiate() mein hostnames permanently store ho jaate hain:**

MongoDB yeh hostnames apne internal config mein store kar leta hai. Har node jaanta hai baaki dono ka exact address.

**Step 2 — Headless service DNS resolve karta hai:**

```
mongodb-1 connect karna chahta hai mongodb-0 se
       ↓
DNS query: mongodb-0.mongodb-headless.database.svc.cluster.local
       ↓
Headless service: "mongodb-0 pod ka IP 10.244.0.5 hai"
       ↓
Direct connection → mongodb-0 pod → port 27017
```

Normal ClusterIP service yeh nahi kar sakti — woh sirf ek single load-balanced IP deti hai. Headless service har pod ka individual IP deti hai.

**Step 3 — Heartbeat every 2 seconds (mesh pattern):**

```
mongodb-0 ←→ mongodb-1   (heartbeat every 2s, port 27017)
mongodb-0 ←→ mongodb-2   (heartbeat every 2s, port 27017)
mongodb-1 ←→ mongodb-2   (heartbeat every 2s, port 27017)
```

Har node baaki dono ko ping karta rehta hai. 10 seconds tak heartbeat nahi aaya → woh node dead considered → election trigger.

---

#### Storage chain — PV, PVC, StorageClass

Before understanding why each node needs its own storage, understand the 3-layer chain:

```
StorageClass  →  PersistentVolume (PV)  →  PersistentVolumeClaim (PVC)
  (how)              (actual disk)              (your request)
```

- **StorageClass** — defines how storage gets created. In Minikube, `standard` class uses the node's local disk.
- **PersistentVolume (PV)** — the actual piece of storage. Created automatically by the StorageClass provisioner.
- **PersistentVolumeClaim (PVC)** — your pod's request for storage. "I need 1Gi, ReadWriteOnce."

**When does PV get created?**

PV does NOT exist until you apply a PVC. The StorageClass provisioner sees your PVC request and creates a matching PV automatically:

```
kubectl apply PVC
       ↓
StorageClass provisioner reacts
       ↓
PV auto-created and bound to your PVC
       ↓
Pod mounts the PVC → gets the PV's storage
```

---

#### Why each node needs its own separate PVC

**Problem 1 — Kubernetes level (ReadWriteOnce):**

`ReadWriteOnce` means only ONE node can mount the PVC at a time.

```
mongodb-0 mounts pvc-shared  → OK ✅
mongodb-1 tries to mount     → BLOCKED ❌ (already in use by mongodb-0)
mongodb-2 tries to mount     → BLOCKED ❌

Result: mongodb-1 and mongodb-2 stay Pending forever
```

**Problem 2 — MongoDB level (even with ReadWriteMany):**

Even if Kubernetes allowed all 3 pods to mount the same PVC, MongoDB would corrupt data:

```
All 3 pods write to the same /data/db folder
       ↓
mongodb-0 writes → WiredTiger engine creates lock files
mongodb-1 writes → sees lock files → CRASH
mongodb-2 writes → overwrites same data files → DATA CORRUPTION
```

MongoDB's storage engine (WiredTiger) assumes it has exclusive ownership of `/data/db`. Three processes sharing one directory = guaranteed corruption.

**Replication is NOT shared disk — it is network sync:**

```
mongodb-0 (PRIMARY) receives a write
       ↓  sends over network (port 27017)
mongodb-1 writes to its OWN /data/db  ← separate PVC
mongodb-2 writes to its OWN /data/db  ← separate PVC
```

Each node keeps a full independent copy. That is High Availability.

---

#### volumeClaimTemplates — how StatefulSet auto-creates one PVC per pod

In a regular Deployment you manually create a PVC file and reference it. StatefulSet does this automatically with `volumeClaimTemplates` — you write a template once, Kubernetes creates a unique PVC for each pod:

```yaml
volumeClaimTemplates:
  - metadata:
      name: mongodb-data        # prefix for the PVC names
    spec:
      accessModes: [ReadWriteOnce]
      storageClassName: standard
      resources:
        requests:
          storage: 1Gi
```

**What gets auto-created:**
```
mongodb-data-mongodb-0   ← PVC for pod mongodb-0  (1Gi, on node disk)
mongodb-data-mongodb-1   ← PVC for pod mongodb-1  (1Gi, on node disk)
mongodb-data-mongodb-2   ← PVC for pod mongodb-2  (1Gi, on node disk)
```

Pattern: `<template-name>-<pod-name>`

**Why this survives pod restarts:**
When `mongodb-0` crashes and StatefulSet recreates it, the new pod gets the SAME name `mongodb-0` — so it binds to the SAME PVC `mongodb-data-mongodb-0`. All data is intact.

---

#### Who becomes PRIMARY — and do you need to set it manually?

**Short answer: No. MongoDB elects PRIMARY automatically. You never set it manually.**

Step 1 — You run `rs.initiate()` from inside `mongodb-0`. Before `mongodb-1` and `mongodb-2` even join, `mongodb-0` gets 1 vote out of 1 available = majority. It declares itself PRIMARY immediately.

Step 2 — `mongodb-1` and `mongodb-2` connect and become SECONDARY automatically.

```
After rs.initiate():

mongodb-0 = PRIMARY   ← because it ran rs.initiate() + has priority 2
mongodb-1 = SECONDARY ← joined after
mongodb-2 = SECONDARY ← joined after
```

---

#### Priority and Voting

**Where are these defined?** Inside `rs.initiate()` — NOT in the StatefulSet YAML. StatefulSet is Kubernetes config (how to run pods). Priority and votes are MongoDB config (how to run elections). They are set once when you bootstrap the replica set.

Every replica set member has two settings that control elections:

**`priority`** — how much does this node WANT to be PRIMARY?
- Higher number = more preferred
- `priority: 0` = this node will NEVER become PRIMARY
- Default is `1` for all nodes

**`votes`** — can this node VOTE in an election?
- `1` = yes, can vote
- `0` = cannot vote (but still replicates data)
- Always have an odd number of voting members to avoid a tie

**How election uses priority:**

```
mongodb-0 (priority: 2) crashes
       ↓
Election starts between mongodb-1 (priority: 1) and mongodb-2 (priority: 1)
       ↓
Both have equal priority → whoever is more up-to-date wins → becomes PRIMARY

mongodb-0 comes back:
       ↓
mongodb-0 catches up with data (syncs from current PRIMARY)
       ↓
mongodb-0 has priority 2 — higher than current PRIMARY (priority 1)
       ↓
MongoDB automatically triggers a stepdown + new election
       ↓
mongodb-0 wins → becomes PRIMARY again
```

**Our setup:**

| Node | Priority | Votes | Role |
|------|----------|-------|------|
| mongodb-0 | 2 | 1 | Preferred PRIMARY — reclaims primary after recovery |
| mongodb-1 | 1 | 1 | Secondary — becomes primary if mongodb-0 is down |
| mongodb-2 | 1 | 1 | Secondary — tiebreaker vote, failover backup |

---

#### What happens after a crash — fully automatic

```
Normal state:
  mongodb-0 = PRIMARY   (priority: 2)
  mongodb-1 = SECONDARY (priority: 1)
  mongodb-2 = SECONDARY (priority: 1)

mongodb-0 crashes:
       ↓ (within 2-3 seconds)
  mongodb-1 + mongodb-2 hold election
  both priority 1, equal → most up-to-date wins
       ↓
  mongodb-1 = PRIMARY  (new)
  mongodb-2 = SECONDARY
  mongodb-0 = (restarting, StatefulSet recreates it)

mongodb-0 comes back:
       ↓
  mongodb-0 syncs data, then: priority 2 > current primary priority 1
       ↓
  automatic stepdown + re-election → mongodb-0 = PRIMARY again
```

**The only manual step in the entire lifecycle is `rs.initiate()` — run once, never again.**

---

#### Architecture flow

```
Application (services namespace)
        │
        │  MONGO_URI with all 3 hosts + replicaSet=rs0
        ▼
mongodb-headless Service (clusterIP: None)
        │  (provides DNS resolution — each pod gets its own IP)
        │
        ├──► mongodb-0.mongodb-headless.database.svc.cluster.local
        │         └── /data/db → mongodb-data-mongodb-0 (dedicated PVC)
        │
        ├──► mongodb-1.mongodb-headless.database.svc.cluster.local
        │         └── /data/db → mongodb-data-mongodb-1 (dedicated PVC)
        │
        └──► mongodb-2.mongodb-headless.database.svc.cluster.local
                  └── /data/db → mongodb-data-mongodb-2 (dedicated PVC)

mongodb-0 = PRIMARY  (priority: 2 — preferred, handles all writes)
mongodb-1 = SECONDARY (priority: 1 — replicates from primary)
mongodb-2 = SECONDARY (priority: 1 — replicates from primary)
```

---

#### Try it yourself

Write 2 files:
1. `K8s/mongodb/service-headless.yaml` — headless service (`clusterIP: None`)
2. `K8s/mongodb/statefulset.yaml` — StatefulSet with 3 replicas, `--replSet rs0`, `volumeClaimTemplates`

Key things to remember:
- `serviceName` in StatefulSet must match the headless service name
- `volumeClaimTemplates` is at the same level as `template`, NOT inside `spec.template.spec`
- MongoDB starts with `command: [mongod, --replSet, rs0, --bind_ip_all]`

#### Fields explained — Headless Service

```yaml
apiVersion: v1
kind: Service
metadata:
  name: mongodb-headless
  namespace: database
spec:
  clusterIP: None
  selector:
    app: mongodb
  ports:
    - port: 27017
      targetPort: 27017
```

| Field | Kya hai | Kyun hai | Remove karo toh |
|-------|---------|----------|-----------------|
| `metadata.name: mongodb-headless` | Name of the service | StatefulSet's `serviceName` must match this. Also becomes the DNS subdomain for pod names | StatefulSet cannot link to service → pods don't get stable DNS names |
| `spec.clusterIP: None` | No load balancer IP assigned | This makes it "headless" — DNS returns individual pod IPs instead of one VIP | Normal service behavior — all pods share one IP, cannot reach them individually by name |
| `spec.selector.app: mongodb` | Route DNS to pods with this label | Links the service to the pods created by the StatefulSet | Service exists but has no pods behind it — DNS returns nothing |
| `spec.ports.port: 27017` | Port the service exposes | MongoDB listens on 27017 | DNS resolves but connection refused |
| `spec.ports.targetPort: 27017` | Port inside the container | Must match MongoDB's listening port | Port mismatch — connection refused |

#### Fields explained — StatefulSet

```yaml
apiVersion: apps/v1
kind: StatefulSet
metadata:
  name: mongodb
  namespace: database
spec:
  serviceName: mongodb-headless   # links to headless service
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

| Field | Kya hai | Kyun hai | Remove karo toh |
|-------|---------|----------|-----------------|
| `spec.serviceName: mongodb-headless` | Links StatefulSet to the headless service | Gives pods their DNS names: `pod-name.serviceName.namespace.svc.cluster.local` | Pods start but have no stable DNS — replica set cannot form |
| `spec.replicas: 3` | How many MongoDB pods to run | 3 = minimum for majority voting without arbiter | Less than 3 → no majority possible if one dies |
| `spec.selector.matchLabels` | Which pods does this StatefulSet manage | Same glue as Deployment — must match pod template labels | Apply fails — required field |
| `spec.template.metadata.labels` | Labels on each pod created | Must match `selector.matchLabels` | Mismatch → StatefulSet creates pods it doesn't consider its own |
| `image: mongo:6.0` | Which MongoDB version to use | Pinning version prevents surprise upgrades | If you write `mongo:latest`, next deployment may break on major version change |
| `imagePullPolicy: IfNotPresent` | Use local image if exists, pull only if not | MongoDB image is public — ok to pull. `Never` would fail if image not pre-pulled | Without it, defaults to `Always` which still works but wastes time |
| `command: [mongod, --replSet, rs0, --bind_ip_all]` | Override MongoDB's default startup command | Without `--replSet rs0`, MongoDB starts in standalone mode — replica set cannot form. Without `--bind_ip_all`, MongoDB only listens on localhost — other pods cannot connect | MongoDB starts but refuses replica set initialization |
| `env.name: MONGO_INITDB_ROOT_USERNAME` | Env var name MongoDB reads to create root user | `MONGO_INITDB_*` is the convention MongoDB expects for initialization | MongoDB starts with no auth user → you cannot authenticate |
| `env.valueFrom.secretKeyRef.name` | Which Secret to read from | Points to `mongodb-secret` created in 2.1 | Pod stays Pending — cannot find the secret |
| `env.valueFrom.secretKeyRef.key` | Which key inside the Secret | `MONGO_ROOT_USERNAME` — must match exact key name in the Secret's `data` | Env var is empty → MongoDB init fails |
| `volumeMounts.name: mongodb-data` | Name of the volume to mount | Must match a volume or volumeClaimTemplate name | Mount fails — pod crashes |
| `volumeMounts.mountPath: /data/db` | Where inside the container to mount | MongoDB stores ALL data in `/data/db` by default | MongoDB cannot find its storage → crashes on start |
| `volumeClaimTemplates.metadata.name: mongodb-data` | Template name — becomes PVC name prefix | Must match `volumeMounts.name` | Mount cannot find its PVC |
| `accessModes: [ReadWriteOnce]` | Only one node can mount this PVC at a time | Each MongoDB pod needs exclusive access to its data | Would need RWX storage which is expensive and still wrong for MongoDB |
| `storageClassName: standard` | Use Minikube's default storage provisioner | `standard` = hostPath on the node's disk — simple, works in Minikube | If you use a non-existent class, PVC stays in Pending forever |
| `storage: 1Gi` | Request 1 gigabyte | Minikube has limited disk — 1Gi is enough for learning | If you request more than available disk, PVC stays Pending |

#### Solution

**Headless Service:**

```yaml
# K8s/mongodb/service-headless.yaml
apiVersion: v1
kind: Service
metadata:
  name: mongodb-headless      # StatefulSet.spec.serviceName must match this
  namespace: database
spec:
  clusterIP: None             # Makes it headless — no VIP, DNS returns pod IPs directly
  selector:
    app: mongodb              # Targets pods with this label
  ports:
    - port: 27017
      targetPort: 27017
```

**StatefulSet:**

```yaml
# K8s/mongodb/statefulset.yaml
apiVersion: apps/v1
kind: StatefulSet
metadata:
  name: mongodb
  namespace: database
spec:
  serviceName: mongodb-headless   # Must match headless service name
  replicas: 3                     # 3 nodes = majority voting without arbiter
  selector:
    matchLabels:
      app: mongodb                # Manages pods with this label
  template:
    metadata:
      labels:
        app: mongodb              # MUST match selector.matchLabels above
    spec:
      containers:
        - name: mongodb
          image: mongo:6.0
          imagePullPolicy: IfNotPresent
          command:
            - mongod
            - "--replSet"
            - "rs0"         # Replica set name — must match rs.initiate()
            - "--bind_ip_all"  # Listen on all interfaces, not just localhost
          ports:
            - containerPort: 27017
          env:
            - name: MONGO_INITDB_ROOT_USERNAME   # MongoDB reads this on first start
              valueFrom:
                secretKeyRef:
                  name: mongodb-secret           # From our secret.yaml
                  key: MONGO_ROOT_USERNAME
            - name: MONGO_INITDB_ROOT_PASSWORD
              valueFrom:
                secretKeyRef:
                  name: mongodb-secret
                  key: MONGO_ROOT_PASSWORD
          volumeMounts:
            - name: mongodb-data      # Must match volumeClaimTemplate name below
              mountPath: /data/db     # MongoDB's data directory
  volumeClaimTemplates:               # Auto-creates one PVC per pod
    - metadata:
        name: mongodb-data            # Prefix: mongodb-data-mongodb-0, -1, -2
      spec:
        accessModes: [ReadWriteOnce]  # Exclusive mount per pod
        storageClassName: standard    # Minikube's default provisioner
        resources:
          requests:
            storage: 1Gi
```

#### Verify

```bash
kubectl apply -f K8s/mongodb/secret.yaml
kubectl apply -f K8s/mongodb/configmap.yaml
kubectl apply -f K8s/mongodb/service-headless.yaml
kubectl apply -f K8s/mongodb/statefulset.yaml

# Watch pods come up in ORDER — 0 first, then 1, then 2
kubectl get pods -n database -w

# Check PVCs auto-created (3 separate ones)
kubectl get pvc -n database
# Expected: mongodb-data-mongodb-0, mongodb-data-mongodb-1, mongodb-data-mongodb-2

# Check PVs also auto-created
kubectl get pv
```

---

#### Bootstrapping the Replica Set (rs.initiate)

**Important — check kubectl context first:**

Before running anything, make sure kubectl is pointing at Minikube, not an EKS cluster:

```bash
kubectl config current-context        # should say "minikube"
kubectl config use-context minikube   # switch if needed
kubectl cluster-info                  # should show 192.168.x.x, not an AWS URL
```

If Minikube is not running: `minikube start`

---

**Step 1 — Connect without credentials (localhost exception):**

On a fresh MongoDB with `--keyFile` enabled, no users exist yet. MongoDB allows ONE unauthenticated connection from localhost — called the **localhost exception**. Use it to set up auth before it closes.

```bash
kubectl exec -it mongodb-0 -n database -- mongosh
```

**Step 2 — Initialize the replica set:**

Enter this command alone, press Enter, wait for `{ ok: 1 }`:

```javascript
rs.initiate({
  _id: "rs0",
  members: [
    { _id: 0, host: "mongodb-0.mongodb-headless.database.svc.cluster.local:27017", priority: 2, votes: 1 },
    { _id: 1, host: "mongodb-1.mongodb-headless.database.svc.cluster.local:27017", priority: 1, votes: 1 },
    { _id: 2, host: "mongodb-2.mongodb-headless.database.svc.cluster.local:27017", priority: 1, votes: 1 }
  ]
})
```

Expected: `{ ok: 1 }` and prompt changes to `rs0 [direct: primary]`

**Step 3 — Create the admin user (CRITICAL: one command at a time):**

Do NOT paste both commands together. Enter them separately:

First, switch database:
```javascript
use admin
```

Wait for `switched to db admin`. Then create the user:
```javascript
db.createUser({ user: "admin", pwd: "password123", roles: [{ role: "root", db: "admin" }] })
```

Expected: `{ ok: 1 }`

Then exit:
```javascript
exit
```

**Step 4 — Verify auth works:**

```bash
kubectl exec -it mongodb-0 -n database -- mongosh -u admin -p password123 --authenticationDatabase admin --eval 'rs.isMaster().primary'
```

Expected output: `mongodb-0.mongodb-headless.database.svc.cluster.local:27017`

**Step 5 — Verify replica set status:**

```bash
kubectl exec -it mongodb-0 -n database -- mongosh -u admin -p password123 --authenticationDatabase admin --eval 'rs.status().members.forEach(m => print(m.name, m.stateStr))'
```

You will see one PRIMARY and two SECONDARYs.

---

#### Why --keyFile is required with --auth and replica sets

MongoDB replica set members authenticate with each other using a shared keyFile. Without it, when you add `--auth`, each pod refuses connections from the other pods — the replica set cannot form.

Rule: `--auth` alone = broken replica set. `--keyFile` = auth enabled + members trust each other.

The keyFile is stored as a Kubernetes Secret and mounted into each pod at `/etc/mongodb/keyfile` with permissions `0400` (owner read-only — MongoDB refuses to start if permissions are too open).

---

#### If things go wrong — fresh start procedure

If auth gets into a broken state (Authentication failed, cannot connect at all):

```bash
# Delete the StatefulSet (PVCs survive)
kubectl delete statefulset mongodb -n database

# Delete PVCs to wipe all data
kubectl delete pvc mongodb-data-mongodb-0 mongodb-data-mongodb-1 mongodb-data-mongodb-2 -n database

# Redeploy — fresh empty database
kubectl apply -f statefulset.yaml

# Wait for all 3 pods Running, then repeat Steps 1-5 above
kubectl get pods -n database -w
```

Why this works: empty `/data/db` means localhost exception is available again — you can connect without credentials and set everything up from scratch.

---

#### Chaos test — verify HA works

```bash
# Check which pod is PRIMARY
kubectl exec -it mongodb-0 -n database -- mongosh -u admin -p password123 --authenticationDatabase admin --eval 'rs.isMaster().primary'

# Kill the PRIMARY
kubectl delete pod mongodb-0 -n database

# Watch StatefulSet recreate it immediately
kubectl get pods -n database -w

# New PRIMARY should be mongodb-1 or mongodb-2
kubectl exec -it mongodb-1 -n database -- mongosh -u admin -p password123 --authenticationDatabase admin --eval 'rs.isMaster().primary'
```

---

## Phase 3 — Auth Service

Auth service needs 4 files: secret → configmap → deployment → service.

All 4 go in `K8s/auth/`.

---

### 3.1 — Secret

#### Concept

Services in the `services` namespace need their own secrets — they cannot use `mongodb-secret` from the `database` namespace. Kubernetes does not allow cross-namespace secret access.

Auth service needs two values:
- `MONGO_URI` — full HA connection string to authdb
- `JWT_SECRET` — random string used to sign and verify tokens

#### Generate your JWT Secret

```bash
# Step 1 — generate a random string
openssl rand -base64 32

# Step 2 — base64 encode it for the YAML
echo -n "your-generated-value" | base64
```

Use YOUR generated value — never use the example shown here.

#### Fields explained

```yaml
apiVersion: v1
kind: Secret
metadata:
  name: auth-secret
  namespace: services
type: Opaque
data:
  MONGO_URI: <base64>
  JWT_SECRET: <base64>
```

| Field | Kya hai | Kyun hai | Remove karo toh |
|-------|---------|----------|-----------------|
| `namespace: services` | Secret in services namespace | Auth pod is in services namespace — same namespace required | Pod cannot find secret → CrashLoopBackOff |
| `MONGO_URI` key | Full MongoDB connection string | App reads `process.env.MONGO_URI` | App falls back to `localhost:27017` — cannot connect to real MongoDB |
| `JWT_SECRET` key | Secret key for JWT signing | Auth service uses this to sign tokens. Payment service calls auth to verify tokens using the same key | Tokens cannot be generated or verified → all requests return 401 |

#### Try it yourself

Create `K8s/auth/secret.yaml`.

#### Solution

```yaml
# K8s/auth/secret.yaml
apiVersion: v1
kind: Secret
metadata:
  name: auth-secret
  namespace: services    # Same namespace as the auth deployment
type: Opaque
data:
  # mongodb://admin:password123@mongodb-0.mongodb-headless.database.svc.cluster.local:27017,
  # mongodb-1.mongodb-headless.database.svc.cluster.local:27017,
  # mongodb-2.mongodb-headless.database.svc.cluster.local:27017/authdb?authSource=admin&replicaSet=rs0&readPreference=primaryPreferred
  MONGO_URI: bW9uZ29kYjovL2FkbWluOnBhc3N3b3JkMTIzQG1vbmdvZGItMC5tb25nb2RiLWhlYWRsZXNzLmRhdGFiYXNlLnN2Yy5jbHVzdGVyLmxvY2FsOjI3MDE3LG1vbmdvZGItMS5tb25nb2RiLWhlYWRsZXNzLmRhdGFiYXNlLnN2Yy5jbHVzdGVyLmxvY2FsOjI3MDE3LG1vbmdvZGItMi5tb25nb2RiLWhlYWRsZXNzLmRhdGFiYXNlLnN2Yy5jbHVzdGVyLmxvY2FsOjI3MDE3L2F1dGhkYj9hdXRoU291cmNlPWFkbWluJnJlcGxpY2FTZXQ9cnMwJnJlYWRQcmVmZXJlbmNlPXByaW1hcnlQcmVmZXJyZWQ=
  # Generate: openssl rand -base64 32 | then echo -n "value" | base64
  JWT_SECRET: <your-base64-encoded-jwt-secret>
```

#### Verify

```bash
kubectl apply -f K8s/auth/secret.yaml
kubectl get secrets -n services
kubectl get secret auth-secret -n services -o jsonpath='{.data.MONGO_URI}' | base64 -d
```

---

### 3.2 — ConfigMap

#### Concept

ConfigMap for application services stores non-sensitive config: port number, inter-service URLs.

`envFrom.configMapRef` loads ALL keys from a ConfigMap as env vars at once — no need to list each key individually. This is why configmaps are perfect for bulk non-sensitive config.

#### Fields explained

```yaml
apiVersion: v1
kind: ConfigMap
metadata:
  name: auth-config
  namespace: services
data:
  PORT: "3001"
```

| Field | Kya hai | Kyun hai | Remove karo toh |
|-------|---------|----------|-----------------|
| `namespace: services` | ConfigMap in services namespace | Auth deployment is in services namespace | Deployment cannot find configmap → pod fails to start |
| `PORT: "3001"` | Port the app should listen on | App reads `process.env.PORT` | App defaults to hardcoded fallback (also 3001) — no immediate crash but bad practice |
| Value in quotes `"3001"` | Forces string type | YAML parses unquoted 3001 as integer. Env vars are strings | Type mismatch potential |

#### Try it yourself

Create `K8s/auth/configmap.yaml`. Auth service needs `PORT = 3001`.

#### Solution

```yaml
# K8s/auth/configmap.yaml
apiVersion: v1
kind: ConfigMap
metadata:
  name: auth-config
  namespace: services
data:
  PORT: "3001"    # Auth service listens on this port
```

#### Verify

```bash
kubectl apply -f K8s/auth/configmap.yaml
kubectl describe configmap auth-config -n services
```

---

### 3.3 — Deployment

#### Concept

A Deployment manages Pods. It ensures the desired number of replicas are always running. If a pod crashes, the Deployment controller creates a new one.

The Deployment does NOT run your container directly — it creates a ReplicaSet, which creates Pods:

```
Deployment
  └── ReplicaSet
        ├── Pod (replica 1)
        └── Pod (replica 2)
```

#### Fields explained

```yaml
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

| Field | Kya hai | Kyun hai | Remove karo toh |
|-------|---------|----------|-----------------|
| `apiVersion: apps/v1` | Deployment is in the apps group | Core v1 doesn't have Deployment | Apply fails with "no kind Deployment" |
| `spec.replicas: 1` | Run 1 copy of this pod | 1 is enough for learning. In production you'd run 2-3 | If 0, no pod runs. If you delete it, nothing restarts |
| `spec.selector.matchLabels` | Which pods does this Deployment manage | Deployment → ReplicaSet → Pods are connected via this label | Required field — apply fails without it |
| `spec.template.metadata.labels` | Labels on every pod created | MUST be identical to `selector.matchLabels` | Mismatch: Deployment creates pods it doesn't recognize — orphan pods pile up |
| `image: auth-service:v1` | Which Docker image to run | Built with `docker build -t auth-service:v1` inside Minikube's Docker | Wrong image name → ImagePullBackOff or wrong code runs |
| `imagePullPolicy: Never` | Never pull from registry, use local only | In Minikube, images are built locally. Pull attempt would fail (no registry) | K8s tries Docker Hub → ImagePullBackOff → pod never starts |
| `containerPort: 3001` | Document which port the container listens on | Does not actually open the port — that is the Service's job. But documents the port for clarity | No functional impact (port still works) but confusing without it |
| `envFrom.configMapRef.name: auth-config` | Load ALL keys from this ConfigMap as env vars | Loads PORT at once. If you add more keys to configmap later, pod gets them automatically | `process.env.PORT` is undefined → app uses hardcoded fallback |
| `env.name: MONGO_URI` | Name of the env var inside the container | App reads `process.env.MONGO_URI` | Env var doesn't exist → app uses localhost fallback → cannot connect to MongoDB |
| `env.valueFrom.secretKeyRef.name` | Which Secret to read from | Points to `auth-secret` | Pod stays Pending — cannot find the referenced secret |
| `env.valueFrom.secretKeyRef.key` | Which key inside the secret | `MONGO_URI` — must match exact key name in secret's `data` | Env var is empty string → connection fails |

**`envFrom` vs `env` — when to use which:**

```
envFrom:                         env:
  - configMapRef:                  - name: MONGO_URI
      name: auth-config              valueFrom:
                                       secretKeyRef:
                                         name: auth-secret
                                         key: MONGO_URI

Loads ALL keys at once            Loads ONE specific key
Used for ConfigMap                Used for Secret (security — only expose what's needed)
No key selection needed           Must name each key explicitly
```

**The selector mechanism — how Deployment, Pods, and Service connect:**

```
Deployment selector.matchLabels: { app: auth-service }
                    ▼ manages pods with
Pod labels:        { app: auth-service }
                    ▼ Service also finds same pods via
Service selector:  { app: auth-service }
```

The label `app: auth-service` is the glue between all three. If any one of them has a different value, the connection breaks silently.

#### Try it yourself

Write `K8s/auth/deployment.yaml`. Image `auth-service:v1`, port 3001, load ConfigMap via `envFrom`, load MONGO_URI and JWT_SECRET from Secret via `env`.

#### Solution

```yaml
# K8s/auth/deployment.yaml
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
      app: auth-service          # Deployment manages pods with this label
  template:
    metadata:
      labels:
        app: auth-service        # MUST match selector above
    spec:
      containers:
        - name: auth-service
          image: auth-service:v1
          imagePullPolicy: Never  # Use local Minikube image — never pull from registry
          ports:
            - containerPort: 3001
          envFrom:
            - configMapRef:
                name: auth-config  # Loads PORT=3001 from configmap
          env:
            - name: MONGO_URI      # Sensitive — load individually from Secret
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

#### Verify

```bash
kubectl apply -f K8s/auth/deployment.yaml
kubectl get pods -n services -l app=auth-service
kubectl logs -n services -l app=auth-service
# Should see: "Auth Service running on port 3001" and "Auth DB connected"
```

---

### 3.4 — Service

#### Concept

A Service gives pods a stable network address. Pods die and restart with new IPs — a Service sits in front and keeps a consistent DNS name and IP.

When you name a Service `auth-service`, Kubernetes automatically registers `auth-service` as a DNS name inside the cluster. Any pod in the same namespace can reach it at `http://auth-service:3001`.

#### Fields explained

```yaml
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

| Field | Kya hai | Kyun hai | Remove karo toh |
|-------|---------|----------|-----------------|
| `metadata.name: auth-service` | Name of the Service — also becomes DNS hostname | `payment-service` calls `http://auth-service:3001` — this name must match | payment-service cannot resolve `auth-service` → all token verifications fail → 401 errors everywhere |
| `spec.type: ClusterIP` | Service is only reachable inside the cluster | Backend services don't need external access — Ingress handles that | Defaults to ClusterIP if omitted. Explicit is better. |
| `spec.selector.app: auth-service` | Route traffic to pods with this label | Must match the pod labels from the Deployment | Service exists but `kubectl get endpoints auth-service` shows no endpoints — no traffic reaches any pod |
| `spec.ports.port: 3001` | Port that THIS service listens on | Other services call `auth-service:3001` — this is the port they use | Port mismatch — connection refused |
| `spec.ports.targetPort: 3001` | Port inside the container | Must match `containerPort` in the Deployment | Service accepts traffic but drops it — cannot forward to container |
| `spec.ports.protocol: TCP` | Use TCP (default) | HTTP/HTTPS is built on TCP | Defaults to TCP if omitted |

#### Try it yourself

Write `K8s/auth/service.yaml`. ClusterIP, port 3001, selector matches Deployment label.

#### Solution

```yaml
# K8s/auth/service.yaml
apiVersion: v1
kind: Service
metadata:
  name: auth-service        # This exact name is used as DNS: http://auth-service:3001
  namespace: services
spec:
  type: ClusterIP           # Internal only — Ingress handles external traffic
  selector:
    app: auth-service       # Routes to pods with this label (matches Deployment)
  ports:
    - port: 3001            # Port other services use to call this service
      targetPort: 3001      # Port inside the container (matches containerPort)
      protocol: TCP
```

#### Verify

```bash
kubectl apply -f K8s/auth/service.yaml
kubectl get services -n services
kubectl get endpoints auth-service -n services
# Endpoints should show a pod IP — if empty, selector doesn't match pod labels
```

---

## Phase 4 — Notification Service

Same 4-file pattern as auth: secret → configmap → deployment → service.

All 4 go in `K8s/notification/`. Concepts are same as Phase 3 — focus on the different values.

---

### 4.1 — Secret

Notification service only needs `MONGO_URI` — no JWT_SECRET (it doesn't issue tokens).

```yaml
# K8s/notification/secret.yaml
apiVersion: v1
kind: Secret
metadata:
  name: notification-secret
  namespace: services
type: Opaque
data:
  # mongodb://admin:password123@mongodb-0...27017,mongodb-1...27017,mongodb-2...27017/notificationdb?authSource=admin&replicaSet=rs0&readPreference=primaryPreferred
  MONGO_URI: bW9uZ29kYjovL2FkbWluOnBhc3N3b3JkMTIzQG1vbmdvZGItMC5tb25nb2RiLWhlYWRsZXNzLmRhdGFiYXNlLnN2Yy5jbHVzdGVyLmxvY2FsOjI3MDE3LG1vbmdvZGItMS5tb25nb2RiLWhlYWRsZXNzLmRhdGFiYXNlLnN2Yy5jbHVzdGVyLmxvY2FsOjI3MDE3LG1vbmdvZGItMi5tb25nb2RiLWhlYWRsZXNzLmRhdGFiYXNlLnN2Yy5jbHVzdGVyLmxvY2FsOjI3MDE3L25vdGlmaWNhdGlvbmRiP2F1dGhTb3VyY2U9YWRtaW4mcmVwbGljYVNldD1yczAmcmVhZFByZWZlcmVuY2U9cHJpbWFyeVByZWZlcnJlZA==
```

---

### 4.2 — ConfigMap

```yaml
# K8s/notification/configmap.yaml
apiVersion: v1
kind: ConfigMap
metadata:
  name: notification-config
  namespace: services
data:
  PORT: "3003"
```

---

### 4.3 — Deployment

Same pattern as auth. Image `notification-service:v1`, port 3003, MONGO_URI from secret, PORT from configmap.

```yaml
# K8s/notification/deployment.yaml
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
        app: notification-service    # Must match selector above
    spec:
      containers:
        - name: notification-service
          image: notification-service:v1
          imagePullPolicy: Never
          ports:
            - containerPort: 3003
          envFrom:
            - configMapRef:
                name: notification-config   # Loads PORT=3003
          env:
            - name: MONGO_URI
              valueFrom:
                secretKeyRef:
                  name: notification-secret
                  key: MONGO_URI
```

---

### 4.4 — Service

```yaml
# K8s/notification/service.yaml
apiVersion: v1
kind: Service
metadata:
  name: notification-service    # payment-service calls http://notification-service:3003
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

### Verify

```bash
kubectl apply -f K8s/notification/secret.yaml
kubectl apply -f K8s/notification/configmap.yaml
kubectl apply -f K8s/notification/deployment.yaml
kubectl apply -f K8s/notification/service.yaml

kubectl get pods -n services -l app=notification-service
kubectl get endpoints notification-service -n services
```

---

## Phase 5 — Payment Service

Same 4-file pattern. All 4 go in `K8s/payment/`.

Payment service is the most complex — it calls both auth-service (token verification) and notification-service (fire notification after payment). These URLs come from the ConfigMap.

---

### 5.1 — Secret

```yaml
# K8s/payment/secret.yaml
apiVersion: v1
kind: Secret
metadata:
  name: payment-secret
  namespace: services
type: Opaque
data:
  # mongodb://admin:password123@mongodb-0...27017,mongodb-1...27017,mongodb-2...27017/paymentdb?authSource=admin&replicaSet=rs0&readPreference=primaryPreferred
  MONGO_URI: bW9uZ29kYjovL2FkbWluOnBhc3N3b3JkMTIzQG1vbmdvZGItMC5tb25nb2RiLWhlYWRsZXNzLmRhdGFiYXNlLnN2Yy5jbHVzdGVyLmxvY2FsOjI3MDE3LG1vbmdvZGItMS5tb25nb2RiLWhlYWRsZXNzLmRhdGFiYXNlLnN2Yy5jbHVzdGVyLmxvY2FsOjI3MDE3LG1vbmdvZGItMi5tb25nb2RiLWhlYWRsZXNzLmRhdGFiYXNlLnN2Yy5jbHVzdGVyLmxvY2FsOjI3MDE3L3BheW1lbnRkYj9hdXRoU291cmNlPWFkbWluJnJlcGxpY2FTZXQ9cnMwJnJlYWRQcmVmZXJlbmNlPXByaW1hcnlQcmVmZXJyZWQ=
```

---

### 5.2 — ConfigMap

Payment service needs its port AND the URLs of services it calls.

`AUTH_SERVICE_URL` and `NOTIFICATION_SERVICE_URL` use short names because all three services are in the same `services` namespace.

```yaml
# K8s/payment/configmap.yaml
apiVersion: v1
kind: ConfigMap
metadata:
  name: payment-config
  namespace: services
data:
  PORT: "3002"
  AUTH_SERVICE_URL: "http://auth-service:3001"           # Short name — same namespace
  NOTIFICATION_SERVICE_URL: "http://notification-service:3003"  # Short name — same namespace
```

---

### 5.3 — Deployment

```yaml
# K8s/payment/deployment.yaml
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
                name: payment-config    # Loads PORT, AUTH_SERVICE_URL, NOTIFICATION_SERVICE_URL
          env:
            - name: MONGO_URI
              valueFrom:
                secretKeyRef:
                  name: payment-secret
                  key: MONGO_URI
```

---

### 5.4 — Service

```yaml
# K8s/payment/service.yaml
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

### Verify

```bash
kubectl apply -f K8s/payment/secret.yaml
kubectl apply -f K8s/payment/configmap.yaml
kubectl apply -f K8s/payment/deployment.yaml
kubectl apply -f K8s/payment/service.yaml

kubectl get pods -n services -l app=payment-service
kubectl get endpoints payment-service -n services
```

---

## Phase 6 — Frontend

Frontend needs 2 files: deployment → service. No secret or configmap needed.

Frontend uses relative URLs (`/api/auth`, `/api/payment`, `/api/notify`) which go through Ingress. No credentials to store.

All 2 files go in `K8s/frontend/`.

---

### 6.1 — Deployment

```yaml
# K8s/frontend/deployment.yaml
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
              value: "production"    # Next.js reads this for optimization
```

---

### 6.2 — Service

```yaml
# K8s/frontend/service.yaml
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
kubectl apply -f K8s/frontend/deployment.yaml
kubectl apply -f K8s/frontend/service.yaml

kubectl get pods -n services -l app=frontend
kubectl get endpoints frontend-service -n services
```

---

## Phase 7 — Ingress

### Concept

An Ingress is a Layer 7 (HTTP) router at the edge of your cluster. It receives external HTTP requests and routes them to the correct Service based on the URL path.

Without Ingress, you would need to expose each service with a NodePort separately. With Ingress, one entry point routes everything.

```
Browser: GET http://192.168.49.2/api/auth/login
                        │
                   Ingress Controller (NGINX pod in cluster)
                        │ reads rules:
                   /api/auth  → auth-service:3001
                   /api/payment → payment-service:3002
                   /api/notify → notification-service:3003
                   /          → frontend-service:3000
```

The **Ingress resource** (your YAML) defines the routing rules.
The **Ingress Controller** (NGINX pod) reads those rules and actually routes traffic.
Enable the controller in Minikube: `minikube addons enable ingress`

### Fields explained

```yaml
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
```

| Field | Kya hai | Kyun hai | Remove karo toh |
|-------|---------|----------|-----------------|
| `apiVersion: networking.k8s.io/v1` | Ingress is in the networking group | Added later than core resources, lives in its own group | Apply fails |
| `namespace: services` | Ingress must be in same namespace as its backend Services | Ingress routes to Services in its own namespace only — cross-namespace routing not supported by default | Ingress applies but returns 503 — cannot find backend services |
| `annotations` | Instructions to the NGINX controller | The Ingress resource is generic — controller-specific behavior is configured via annotations | Without `use-regex: "true"`, regex paths won't work |
| `spec.ingressClassName: nginx` | Which Ingress controller handles this | Multiple controllers can exist in one cluster. This picks NGINX | Ingress is ignored — no controller picks it up |
| `spec.rules[].http.paths[].path` | URL path to match | The router matches incoming request paths against this | Wrong path → 404 |
| `pathType: Prefix` | Match any path starting with this prefix | `/api/auth` matches `/api/auth/login`, `/api/auth/register`, etc. | `Exact` would only match `/api/auth` exactly — subpaths return 404 |
| `backend.service.name` | Forward to this Service | Must match `metadata.name` of your Service exactly | 503 — backend service not found |
| `backend.service.port.number` | Which port on the Service | Must match `spec.ports.port` in your Service | Connection refused |

**Order matters:**
More specific paths (`/api/auth`, `/api/payment`, `/api/notify`) MUST come before the catch-all `/`. NGINX matches top to bottom — if `/` comes first, all traffic goes to frontend.

### Try it yourself

Write `K8s/ingress/ingress.yaml` routing all 4 services.

### Solution

```yaml
# K8s/ingress/ingress.yaml
apiVersion: networking.k8s.io/v1
kind: Ingress
metadata:
  name: app-ingress
  namespace: services           # Same namespace as all backend services
  annotations:
    nginx.ingress.kubernetes.io/use-regex: "true"
spec:
  ingressClassName: nginx       # Use the NGINX controller
  rules:
    - http:
        paths:
          - path: /api/auth     # Specific paths FIRST
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
          - path: /             # Catch-all LAST — frontend gets everything else
            pathType: Prefix
            backend:
              service:
                name: frontend-service
                port:
                  number: 3000
```

### Verify

```bash
minikube addons enable ingress
kubectl get pods -n ingress-nginx -w    # Wait for controller to be Running

kubectl apply -f K8s/ingress/ingress.yaml
kubectl get ingress -n services

minikube ip   # Get the cluster IP

# Test frontend loads
curl http://$(minikube ip)/

# Test health from inside pods (health endpoint is at /health, not /api/auth/health)
kubectl exec -it $(kubectl get pod -n services -l app=auth-service -o name | head -1) -n services -- wget -qO- http://localhost:3001/health
kubectl exec -it $(kubectl get pod -n services -l app=payment-service -o name | head -1) -n services -- wget -qO- http://localhost:3002/health
kubectl exec -it $(kubectl get pod -n services -l app=notification-service -o name | head -1) -n services -- wget -qO- http://localhost:3003/health

# Test full flow through Ingress
curl -X POST http://$(minikube ip)/api/auth/register \
  -H "Content-Type: application/json" \
  -d '{"name":"test","email":"test@test.com","password":"password123"}'
```

---

## Full Deploy Order — Step by Step

Run these commands in this exact order. Each step depends on the previous one.

**Note on `registry-nodeport.yaml`:** This file in the project root exposes Minikube's built-in registry addon via NodePort 30501. It is an alternative to `eval $(minikube docker-env)` — for this guide we use `eval $(minikube docker-env)` so this file is not needed.

```bash
# Step 0 — build images inside Minikube's Docker daemon
# IMPORTANT: eval $(minikube docker-env) switches your shell to use Minikube's Docker.
# Any image you build after this goes into Minikube directly — not your host Docker.
# You must run this in EVERY new terminal session before building.
eval $(minikube docker-env)
cd ~/my-projects/microservices-app-minikube

docker build -t auth-service:v1 ./auth-service
docker build -t payment-service:v1 ./payment-service
docker build -t notification-service:v1 ./notification-service
docker build -t frontend:v1 ./frontend

# Confirm images exist inside Minikube
docker images | grep -E "auth|payment|notification|frontend"

# Step 1 — namespaces (everything depends on these)
kubectl apply -f K8s/namespaces/namespaces.yaml
kubectl get namespaces

# Step 2 — MongoDB (4 files in order)
kubectl apply -f K8s/mongodb/secret.yaml
kubectl apply -f K8s/mongodb/configmap.yaml
kubectl apply -f K8s/mongodb/service-headless.yaml
kubectl apply -f K8s/mongodb/statefulset.yaml

# Watch pods come up in order: 0 → 1 → 2
kubectl get pods -n database -w
# Press Ctrl+C once all 3 show Running

# Step 3 — Initialize the replica set (run ONCE after all 3 pods are Running)
kubectl exec -it mongodb-0 -n database -- mongosh -u admin -p password123 --authenticationDatabase admin --eval '
rs.initiate({
  _id: "rs0",
  members: [
    { _id: 0, host: "mongodb-0.mongodb-headless.database.svc.cluster.local:27017", priority: 2, votes: 1 },
    { _id: 1, host: "mongodb-1.mongodb-headless.database.svc.cluster.local:27017", priority: 1, votes: 1 },
    { _id: 2, host: "mongodb-2.mongodb-headless.database.svc.cluster.local:27017", priority: 1, votes: 1 }
  ]
})'

# Step 4 — Auth service (payment depends on auth)
kubectl apply -f K8s/auth/secret.yaml
kubectl apply -f K8s/auth/configmap.yaml
kubectl apply -f K8s/auth/deployment.yaml
kubectl apply -f K8s/auth/service.yaml

kubectl get pods -n services -w

# Step 5 — Notification service (payment depends on notification)
kubectl apply -f K8s/notification/secret.yaml
kubectl apply -f K8s/notification/configmap.yaml
kubectl apply -f K8s/notification/deployment.yaml
kubectl apply -f K8s/notification/service.yaml

# Step 6 — Payment service
kubectl apply -f K8s/payment/secret.yaml
kubectl apply -f K8s/payment/configmap.yaml
kubectl apply -f K8s/payment/deployment.yaml
kubectl apply -f K8s/payment/service.yaml

# Step 7 — Frontend
kubectl apply -f K8s/frontend/deployment.yaml
kubectl apply -f K8s/frontend/service.yaml

# Step 8 — Ingress (after all services are up)
minikube addons enable ingress
kubectl get pods -n ingress-nginx -w   # wait for controller to be Running
kubectl apply -f K8s/ingress/ingress.yaml

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
- `PVC not bound` — storage class issue, check `kubectl get pvc -n database`

### Pod stuck in CrashLoopBackOff

```bash
kubectl logs <pod-name> -n <namespace>
kubectl logs <pod-name> -n <namespace> --previous   # logs from last crash
```

Common causes:
- Wrong MONGO_URI — check: `kubectl get secret auth-secret -n services -o jsonpath='{.data.MONGO_URI}' | base64 -d`
- Image not found — did you run `eval $(minikube docker-env)` before building?
- Port mismatch — container port vs app listening port

### ImagePullBackOff

```bash
kubectl describe pod <pod-name> -n <namespace>
```

K8s tried to pull from Docker Hub and failed. Fix:
- You forgot `eval $(minikube docker-env)` before building — image is in host Docker not Minikube's
- `imagePullPolicy` is not `Never` — add it to the Deployment

### Service not reachable

```bash
# If endpoints are empty — selector doesn't match pod labels
kubectl get endpoints <service-name> -n <namespace>
kubectl get pod <pod-name> -n <namespace> --show-labels

# Test connectivity from inside a pod
kubectl exec -it <pod-name> -n services -- wget -qO- http://auth-service:3001/health
kubectl exec -it <pod-name> -n services -- wget -qO- http://mongodb-0.mongodb-headless.database.svc.cluster.local:27017
```

### Wrong or missing env var

```bash
kubectl exec -it <pod-name> -n services -- env | grep MONGO
kubectl exec -it <pod-name> -n services -- env | grep PORT
```

### Ingress returning 404

```bash
kubectl describe ingress app-ingress -n services
kubectl get services -n services
# Check paths are correct and backend service names match exactly
```

### MongoDB pods stuck in Pending

```bash
kubectl describe pod mongodb-1 -n database
kubectl get pvc -n database
# Should see: mongodb-data-mongodb-0, mongodb-data-mongodb-1, mongodb-data-mongodb-2
```

### Replica set not forming

```bash
# Check if headless service DNS resolves
kubectl exec -it mongodb-0 -n database -- nslookup mongodb-1.mongodb-headless.database.svc.cluster.local
# If this fails — headless service selector doesn't match pod labels
```

### rs.initiate() fails with "already initialized"

```bash
kubectl exec -it mongodb-0 -n database -- mongosh -u admin -p password123 --authenticationDatabase admin --eval 'rs.status()'
# It may have already worked — check the status
```

### App cannot connect to MongoDB

```bash
kubectl get secret auth-secret -n services -o jsonpath='{.data.MONGO_URI}' | base64 -d
# Verify URI has replicaSet=rs0 and correct credentials
```

### Useful one-liners

```bash
kubectl get all -n services
kubectl get all -n database

kubectl delete deployment auth-deployment -n services
kubectl apply -f K8s/auth/deployment.yaml

kubectl logs -f <pod-name> -n services
kubectl get pod -n services -l app=auth-service -o name
kubectl get pods -n services -o wide
```

---

## Key Rules to Never Forget

| Rule | Why |
|------|-----|
| Check `kubectl config current-context` before every session | kubectl may be pointing at EKS or another cluster — everything runs on the wrong cluster silently |
| Run `minikube start` if cluster-info shows "no route to host" | Minikube VM is stopped — all kubectl commands fail |
| Secret values must be base64 encoded with `echo -n` | Trailing newline breaks connections silently |
| Secret namespace must match the pod using it | K8s cannot reference secrets across namespaces |
| `imagePullPolicy: Never` for all local images | Without it, K8s tries Docker Hub and fails |
| Run `eval $(minikube docker-env)` before every build | Without it, images go to host Docker not Minikube |
| Service `metadata.name` = DNS hostname | Name it `auth-service` and it's reachable at `http://auth-service` |
| Deployment `selector.matchLabels` must match Pod `template.metadata.labels` | Mismatch = orphan pods that are never managed |
| `volumeClaimTemplates` is at StatefulSet spec level, not inside template | Wrong indentation = YAML validation error |
| Ingress specific paths before catch-all `/` | NGINX matches top to bottom |
| Cross-namespace DNS = `<service>.<namespace>.svc.cluster.local` | Short names only work within the same namespace |
| Priority and votes are set in `rs.initiate()` not in StatefulSet YAML | StatefulSet is Kubernetes config. Priority is MongoDB config |
| `--auth` alone breaks replica sets — use `--keyFile` instead | Replica set members authenticate with each other via keyFile; without it pods cannot connect to each other |
| In mongosh, run `use admin` and `db.createUser()` as separate commands | Pasting both together as a multi-line block may run createUser in wrong database context |
| StatefulSet rollout updates pods from highest ordinal to lowest (2→1→0) | If pod 2 crashes, rollout blocks — pod 0 and 1 never get the new spec. Force delete stuck pods. |
