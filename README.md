# kubernetes-monitoring
This k8s resources deploy the monitoring and logging service on Microsoft Azure AKS.

monitoring: [Prometheus](https://prometheus.io/) & [Grafana](https://grafana.com/)  
logging: [Elasticsearch](https://www.elastic.co/jp/products/elasticsearch) & [fluentd](https://www.fluentd.org/) & [Kibana](https://www.elastic.co/products/kibana)

## Usage
### prepare AKS
1. start Azure AKS
    * select the vm series like Dsv3-series which supportes the Premium Storage

    ```bash
    $ az group create --name k8s --location japaneast
    $ az aks create --resource-group k8s --name k8saks --node-count 3 --ssh-key-value $HOME/.ssh/azure.pub --node-vm-size Standard_D2s_v3 --kubernetes-version 1.11.1
    $ az aks get-credentials --resource-group k8s --name k8saks
    ```

### prepare helm
1. create a ServiceAccount as `tiller` which has the `cluster-admin` ClusterRole.

    ```bash
    $ kubectl apply -f rbac/tiller-rbac.yaml
    ```
1. install helm according to [install guide](https://docs.helm.sh/using_helm/#installing-helm).
1. initialize helm using `tiller` ServiceAccount

    ```bash
    $ helm init --service-account tiller
    $ helm repo update
    ```
1. enable helm charts of [coreos](https://coreos.com/)

    ```bash
    $ helm repo add coreos https://s3-eu-west-1.amazonaws.com/coreos-charts/stable/
    ```
1. confirm that a tiller is launched successfully

    ```bash
    $ kubectl get pod --namespace kube-system -l app=helm -l name=tiller
    ```

### prepare Prometheus & Grafana
1. install coreos/prometheus-operator

    ```bash
    $ helm install coreos/prometheus-operator --name pg-op --namespace monitoring
    ```
1. confirm that `prometheus-operator` has been launched

    ```bash
    $ kubectl get jobs --namespace monitoring -l app=prometheus-operator -l release=pg-op
    $ kubectl get pods --namespace monitoring -l app=prometheus-operator -l release=pg-op
    ```
1. edit `monitoring/kube-prometheus-azure.yaml`
    * change persistent volume size, storagClass and so on if you needed

    ```bash
    $ vi monitoring/kube-prometheus-azure.yaml
    ```
1. install Prometheus & Grafana

    ```bash
    $ helm install coreos/kube-prometheus --name pg --namespace monitoring -f monitoring/kube-prometheus-azure.yaml
    ```
1.  confirm that Prometheus and Grafana is launched
    * confirm that AlertManager is launched successfully

        ```bash
        $ kubectl get persistentvolumeclaims --namespace monitoring -l app=alertmanager
        ```
        ```bash
        $ kubectl get pods -n monitoring -l app=alertmanager
        ```
    * confirm that Prometheus is launched successfully

        ```bash
        $ kubectl get persistentvolumeclaims --namespace monitoring -l app=prometheus
        ```
        ```bash
        $ kubectl get pods --namespace monitoring -l app=prometheus
        ```
    * confirm that grafana is launched successfully

        ```bash
        $ kubectl get pods --namespace monitoring -l app=pg-grafana
        ```
    * confirm that node-exporter is launched successfully on each node

        ```bash
        $ kubectl get daemonsets --namespace monitoring
        $ kubectl get pods --namespace monitoring -l app=pg-exporter-node -o wide
        ```

### patch some resources to adapt Azure AKS
1. patch `kube-dns-v20` since default kube-dns of Azure AKS does not export dns metrics
    * https://github.com/Azure/AKS/issues/345

    ```bash
    $ kubectl patch deployment -n kube-system kube-dns-v20 --patch "$(cat monitoring/kube-dns-metrics-patch.yaml)"
    ```
1. patch ServiceMonitor resource of `pg-exporter-kubelet` to look for the http endpoints
    * https://github.com/coreos/prometheus-operator/issues/926

    ```bash
    $ kubectl get servicemonitors pg-exporter-kubelets --namespace monitoring -o yaml | sed 's/https/http/' | kubectl replace -f -
    ```
1. delete monitor of apiserver because apiserver of Azure AKS does not allow to connect apiserver directry
    * https://github.com/coreos/prometheus-operator/issues/1522

    ```bash
    $ kubectl delete servicemonitor pg-exporter-kubernetes --namespace monitoring
    ```

### delete some Alerts to adapt Azure AKS
1. delete `alert: DeadMansSwitch`

    ```bash
    $ kubectl edit prometheusrule pg-kube-prometheus --namespace monitoring
    ```
    ```diff
           for: 10m
           labels:
             severity: warning
    -    - alert: DeadMansSwitch
    -      annotations:
    -        description: This is a DeadMansSwitch meant to ensure that the entire Alerting
    -          pipeline is functional.
    -        summary: Alerting DeadMansSwitch
    -      expr: vector(1)
    -      labels:
    -        severity: none
         - expr: process_open_fds / process_max_fds
           record: fd_utilization
         - alert: FdExhaustionClose
     ```
1. delete `alert: K8SApiserverDown`

    ```bash
    $ kubectl edit prometheusrule pg-exporter-kubernetes --namespace monitoring
    ```
    ```diff
           for: 10m
           labels:
             severity: critical
    -    - alert: K8SApiserverDown
    -      annotations:
    -        description: No API servers are reachable or all have disappeared from service
    -          discovery
    -        summary: No API servers are reachable
    -      expr: absent(up{job="apiserver"} == 1)
    -      for: 20m
    -      labels:
    -        severity: critical
         - alert: K8sCertificateExpirationNotice
           annotations:
             description: Kubernetes API Certificate is expiring soon (less than 7 days)
    ```
1. delete `alert: K8SControllerManagerDown`

    ```bash
    $ kubectl edit prometheusrule pg-exporter-kube-controller-manager --namespace monitoring
    ```
    ```diff
     spec:
       groups:
       - name: kube-controller-manager.rules
    -    rules:
    -    - alert: K8SControllerManagerDown
    -      annotations:
    -        description: There is no running K8S controller manager. Deployments and replication
    -          controllers are not making progress.
    -        runbook: https://coreos.com/tectonic/docs/latest/troubleshooting/controller-recovery.html#recovering-a-controller-manager
    -        summary: Controller manager is down
    -      expr: absent(up{job="kube-controller-manager"} == 1)
    -      for: 5m
    -      labels:
    -        severity: critical
    +    rules: []
    ```
1. delete `alert: K8SSchedulerDown`

    ```bash
    $ kubectl edit prometheusrule pg-exporter-kube-scheduler --namespace monitoring
    ```
    ```diff
           labels:
             quantile: "0.5"
           record: cluster:scheduler_binding_latency_seconds:quantile
    -    - alert: K8SSchedulerDown
    -      annotations:
    -        description: There is no running K8S scheduler. New pods are not being assigned
    -          to nodes.
    -        runbook: https://coreos.com/tectonic/docs/latest/troubleshooting/controller-recovery.html#recovering-a-scheduler
    -        summary: Scheduler is down
    -      expr: absent(up{job="kube-scheduler"} == 1)
    -      for: 5m
    -      labels:
    -        severity: critical
    ```

### show Prometheus Dashboard
1. port forward to prometheus

    ```bash
    $ kubectl port-forward $(kubectl get pod --namespace monitoring -l prometheus=kube-prometheus -l app=prometheus -o template --template "{{(index .items 0).metadata.name}}") --namespace monitoring 9090:9090
    ```
1. open http://localhost:9090/targets and confirm that no `State` is down
1. open http://localhost:9090/alerts and confirm that no `Alert` is fired

### show Grafana Dashboard
1. port forward to grafana

    ```bash
    $ kubectl port-forward $(kubectl get pod --namespace monitoring -l app=pg-grafana -o template --template "{{(index .items 0).metadata.name}}") --namespace monitoring 3000:3000
    ```
1. open http://localhost:3000/
1. log in grafana (initial username/password is admin/admin)
1. show dashboard
    * if you have seen no graph, you have to reconfigure datasource of prometheus (URL: `http://pg-prometheus:9090/` )
    * Unfortunately, the status of Control Plane is N/A because the exporter of kubernetes control plane has been deleted above
1. add a dashboard to show the capacity of persistent volumes
    * import `monitoring/dashboard_persistent_volumes.json`

### prepare Elasticsearch & Fluentd & Kibana
1. install Elasticsearch

    ```bash
    $ kubectl apply -f logging/es-statefulset.yaml
    $ kubectl apply -f logging/es-service.yaml
    ```
1. confirm that Elasticsearch is launched
    * confirm that a StatefulSet is running successfully

        ```bash
        $ kubectl get statefulsets --namespace monitoring -l k8s-app=elasticsearch-logging
        ```
    * confirm that two Pods are running successfully

        ```bash
        $ kubectl get pods --namespace monitoring -l k8s-app=elasticsearch-logging
        ```
    * confirm that two PersistentVolumeClaims are running successfully

        ```bash
        $ kubectl get persistentvolumeclaims --namespace monitoring -l k8s-app=elasticsearch-logging
        ```
    * confirm that a Service is running successfully

        ```bash
        $ kubectl get services --namespace monitoring -l k8s-app=elasticsearch-logging
        ```
1. enable routing allocation of Elasticsearch cluster

    ```bash
    $ kubectl exec -it elasticsearch-logging-0 --namespace monitoring -- curl -H "Content-Type: application/json" -X PUT http://elasticsearch-logging:9200/_cluster/settings -d '{"transient": {"cluster.routing.allocation.enable":"all"}}'
    ```
1. install Fluentd

    ```bash
    $ kubectl apply -f logging/fluentd-es-configmap.yaml
    $ kubectl apply -f logging/fluentd-es-ds.yaml
    ```
1. confirm that a DaemonSet is running and a pod is running successfully on each node

    ```bash
    $ kubectl get daemonsets --namespace monitoring -l k8s-app=fluentd-es
    $ kubectl get pods --namespace monitoring -l k8s-app=fluentd-es -o wide
    ```
1. install Kibana

    ```bash
    $ kubectl apply -f logging/kibana-deployment.yaml
    $ kubectl apply -f logging/kibana-service.yaml
    ```
1. confirm that Kibana is launched successfully
    * confirm that a Deployment is running successfully

        ```bash
        $ kubectl get deployments --namespace monitoring -l k8s-app=kibana-logging
        ```
    * confirm that a Pod is running successfully

        ```bash
        $ kubectl get pods --namespace monitoring -l k8s-app=kibana-logging
        ```
    * confirm that a Service is running successfully

        ```bash
        $ kubectl get services --namespace monitoring -l k8s-app=kibana-logging
        ```
1. install Curator

    ```bash
    $ kubectl apply -f logging/curator-configmap.yaml
    $ kubectl apply -f logging/curator-cronjob.yaml
    ```
1. confirm that a CronJob of Curator is registered

    ```bash
    $ kubectl get cronjobs --namespace monitoring -l k8s-app=elasticsearch-curator
    ```

### show Kibana Dashboard
1. port forward to kibana

    ```bash
    $ kubectl port-forward $(kubectl get pod --namespace monitoring -l k8s-app=kibana-logging -o template --template "{{(index .items 0).metadata.name}}") --namespace monitoring 5601:5601
    ```
1. open http://localhost:5601
1. set up index from "Management -> Index Patterns"
    * Index Pattern: `logstash-*`
    * Time filter field: `@timestamp`

### add Elasticsearch as a Datasource to Grafana
1. open Configuration -> DataSource and add a DataSource connecting to Elasticsearch
    * name: `elasticsearch`
    * Type: `Elasticsearch`
    * URL: `http://elasticsearch-logging:9200/`
    * Access: `Server(Default)`
    * Index name: `logstash-*`
    * Time field nama: `@timestamp`
    * Version: `5.6+`
1. import `monitoring/dashboard_elasticsearch.json` to add `Elasticsearch` dashboard
1. When you open `Elasticsearch` dashboard, you can see the raw Elasticsearch log table and log count graph


## License

[MIT License](/LICENSE)

## Copyright
Copyright (c) 2018 Nobuyuki Matsui <nobuyuki.matsui@gmail.com>
