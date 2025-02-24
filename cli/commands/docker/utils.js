const fs = require('fs');
const fse = require('fs-extra');
const yaml = require('yaml');
const { log, sleep, execCommand, filePath, execCurl } = require('../utils');

const commonEnvs = configs => {
  const db_server_address = configs.db_server_address;
  const widgets = configs.widgets || {};
  const redis = configs.redis || {};
  const rabbitmq = configs.rabbitmq || {};
  const rabbitmq_host = `amqp://${rabbitmq.user}:${
    rabbitmq.pass
  }@${rabbitmq.server_address || db_server_address}:5672/${rabbitmq.vhost}`;

  return {
    ELASTIC_APM_HOST_NAME: configs.elastic_apm_host_name,
    DEBUG: 'erxes*',
    NODE_ENV: 'production',
    DOMAIN: configs.domain,
    WIDGETS_DOMAIN: widgets.domain || `${configs.domain}/widgets`,
    REDIS_HOST: db_server_address,
    REDIS_PORT: 6379,
    REDIS_PASSWORD: redis.password || '',
    RABBITMQ_HOST: rabbitmq_host,
    ELASTICSEARCH_URL: `${db_server_address}:9200`,
    ENABLED_SERVICES_PATH: '/data/enabled-services.js',
    MESSAGE_BROKER_PREFIX: rabbitmq.prefix || ''
  };
};

const cleaning = async () => {
  await execCommand('docker rm $(docker ps -a -q -f status=exited)', true);
  await execCommand('docker rmi $(docker images -f dangling=true -q)', true);
  await execCommand(
    'docker volume rm $(docker volume ls -q -f dangling=true)',
    true
  );
};

const mongoEnv = (configs, plugin) => {
  const mongo = configs.mongo || {};
  const db_server_address = configs.db_server_address;

  let db_name = mongo.db_name || 'erxes';

  if (plugin && plugin.db_name) {
    db_name = plugin.db_name;
  }

  const mongo_url = `mongodb://${mongo.username}:${mongo.password}@${db_server_address}:27017/${db_name}?authSource=admin&replicaSet=rs0`;

  return mongo_url;
};

const healthcheck = {
  test: ['CMD', 'curl', '-i', 'http://localhost:80/health']
};

const deploy = {
  mode: 'replicated',
  replicas: 2,
  update_config: {
    order: 'start-first',
    failure_action: 'rollback',
    delay: '1s'
  }
};

const generatePluginBlock = (configs, plugin) => {
  const api_mongo_url = mongoEnv(configs, {});
  const mongo_url = plugin.mongo_url || mongoEnv(configs, plugin);
  const image_tag = configs.image_tag || 'federation';

  const conf = {
    image: `erxes/plugin-${plugin.name}-api:${image_tag}`,
    environment: {
      SERVICE_NAME: plugin.name,
      PORT: plugin.port || 80,
      API_MONGO_URL: api_mongo_url,
      MONGO_URL: mongo_url,
      LOAD_BALANCER_ADDRESS: `http://plugin_${plugin.name}_api`,
      ...commonEnvs(configs),
      ...(plugin.extra_env || {})
    },
    volumes: ['./enabled-services.js:/data/enabled-services.js'],
    networks: ['erxes'],
    extra_hosts: [
      `mongo:${plugin.db_server_address ||
        configs.db_server_address ||
        '127.0.0.1'}`
    ]
  };

  if (plugin.replicas) {
    conf.deploy = {
      replicas: plugin.replicas,
    }
  }

  return conf;
};

const syncS3 = async name => {
  log(`Downloading ${name} ui build.tar from s3`);

  const plName = `plugin-${name}-ui`;

  await execCommand(
    `aws s3 sync s3://erxes-plugins/uis/${plName} plugin-uis/${plName} --no-sign-request --exclude "*" --include build.tar`
  );

  log(`Extracting build ......`);
  await execCommand(
    `tar -xf plugin-uis/${plName}/build.tar --directory=plugin-uis/${plName}`
  );

  log(`Removing build.tar ......`);
  await execCommand(`rm plugin-uis/${plName}/build.tar`);
};

const deployDbs = async program => {
  await cleaning();

  const configs = await fse.readJSON(filePath('configs.json'));

  const dockerComposeConfig = {
    version: '3.3',
    networks: {
      erxes: {
        driver: 'overlay'
      }
    },
    services: {}
  };

  if (configs.kibana) {
    dockerComposeConfig.services.kibana = {
      image: 'docker.elastic.co/kibana/kibana:7.6.0',
      ports: ['5601:5601'],
      networks: ['erxes']
    };
  }

  if (configs.mongo) {
    if (!(await fse.exists(filePath('mongodata')))) {
      await execCommand('mkdir mongodata');
    }

    dockerComposeConfig.services.mongo = {
      hostname: 'mongo',
      image: 'mongo:4.0.20',
      ports: ['27017:27017'],
      environment: {
        MONGO_INITDB_ROOT_USERNAME: configs.mongo.username,
        MONGO_INITDB_ROOT_PASSWORD: configs.mongo.password
      },
      networks: ['erxes'],
      volumes: ['./mongodata:/data/db'],
      command: ['--replSet', 'rs0', '--bind_ip_all'],
      extra_hosts: ['mongo:127.0.0.1']
    };
  }

  if (configs.elasticsearch) {
    if (!(await fse.exists(filePath('elasticsearchData')))) {
      await execCommand('mkdir elasticsearchData');
    }

    dockerComposeConfig.services.elasticsearch = {
      image: 'docker.elastic.co/elasticsearch/elasticsearch:7.8.0',
      environment: {
        'discovery.type': 'single-node'
      },
      ports: ['9200:9200'],
      networks: ['erxes'],
      volumes: ['./elasticsearchData:/usr/share/elasticsearch/data'],
      ulimits: {
        memlock: {
          soft: -1,
          hard: -1
        }
      }
    };
  }

  if (configs.redis) {
    if (!(await fse.exists(filePath('redisdata')))) {
      await execCommand('mkdir redisdata');
    }

    dockerComposeConfig.services.redis = {
      image: 'redis:5.0.5',
      command: `redis-server --appendonly yes --requirepass ${configs.redis.password}`,
      ports: ['6379:6379'],
      networks: ['erxes'],
      volumes: ['./redisdata:/data']
    };
  }

  if (configs.rabbitmq) {
    if (!(await fse.exists(filePath('rabbitmq-data')))) {
      await execCommand('mkdir rabbitmq-data');
    }

    dockerComposeConfig.services.rabbitmq = {
      image: 'rabbitmq:3.7.17-management',
      hostname: 'rabbitmq',
      environment: {
        RABBITMQ_VM_MEMORY_HIGH_WATERMARK: '2048MiB',
        RABBITMQ_ERLANG_COOKIE: configs.rabbitmq.cookie,
        RABBITMQ_DEFAULT_USER: configs.rabbitmq.user,
        RABBITMQ_DEFAULT_PASS: configs.rabbitmq.pass,
        RABBITMQ_DEFAULT_VHOST: configs.rabbitmq.vhost
      },
      ports: ['5672:5672', '15672:15672'],
      networks: ['erxes'],
      volumes: ['./rabbitmq-data:/var/lib/rabbitmq']
    };
  }

  const yamlString = yaml.stringify(dockerComposeConfig);

  log('Generating docker-compose-dbs.yml ....');

  fs.writeFileSync(filePath('docker-compose-dbs.yml'), yamlString);

  log('Deploy ......');

  return execCommand(
    'docker stack deploy --compose-file docker-compose-dbs.yml erxes-dbs --with-registry-auth --resolve-image changed'
  );
};

const up = async ({ uis, fromInstaller }) => {
  await cleaning();

  const configs = await fse.readJSON(filePath('configs.json'));

  const image_tag = configs.image_tag || 'federation';
  const domain = configs.domain;
  const gateway_url = `${domain}/gateway`;
  const subscription_url = `wss://${gateway_url.replace(
    'https://',
    ''
  )}/graphql`;
  const widgets = configs.widgets || {};
  const dashboard = configs.dashboard;
  const widgets_domain = widgets.domain || `${domain}/widgets`;
  const dashboard_domain = `${domain}/dashboard/front`;
  const dashboard_api_domain = `${domain}/dashboard/api`;
  const db_server_address = configs.db_server_address;

  const NGINX_HOST = domain.replace('https://', '');
  const extra_hosts = [`mongo:${db_server_address || '127.0.0.1'}`];
  const { RABBITMQ_HOST } = commonEnvs(configs);

  // update the directory on the Docker system to have 0777 or drwxrwxrwx permssion, so that all users have read/write/execute permission.
  // chmod 0777 core-api-uploads
  if (!(await fse.exists(filePath('core-api-uploads')))) {
    await execCommand('mkdir core-api-uploads');
  }

  const dockerComposeConfig = {
    version: '3.7',
    networks: {
      erxes: {
        driver: 'overlay'
      }
    },
    services: {
      coreui: {
        image: `erxes/erxes:federation`,
        environment: {
          REACT_APP_PUBLIC_PATH: '',
          REACT_APP_CDN_HOST: widgets_domain,
          REACT_APP_API_URL: gateway_url,
          REACT_APP_DASHBOARD_URL: dashboard_domain,
          REACT_APP_API_SUBSCRIPTION_URL: subscription_url,
          NGINX_HOST,
          NODE_ENV: 'production',
          REACT_APP_FILE_UPLOAD_MAX_SIZE: 524288000,
          ...((configs.coreui || {}).extra_env || {})
        },
        ports: ['3000:80'],
        volumes: [
          './plugins.js:/usr/share/nginx/html/js/plugins.js',
          './plugin-uis:/usr/share/nginx/html/js/plugins'
        ],
        deploy,
        networks: ['erxes']
      },
      plugin_core_api: {
        image: `erxes/core:${image_tag}`,
        environment: {
          SERVICE_NAME: 'core-api',
          PORT: '80',
          CLIENT_PORTAL_DOMAINS: configs.client_portal_domains || '',
          JWT_TOKEN_SECRET: configs.jwt_token_secret,
          LOAD_BALANCER_ADDRESS: 'http://plugin_core_api',
          MONGO_URL: mongoEnv(configs),
          EMAIL_VERIFIER_ENDPOINT:
            configs.email_verifier_endpoint ||
            'https://email-verifier.erxes.io',
          ENABLED_SERVICES_PATH: '/data/enabled-services.js',
          ...commonEnvs(configs),
          ...((configs.core || {}).extra_env || {})
        },
        extra_hosts,
        volumes: [
          './enabled-services.js:/data/enabled-services.js',
          './permissions.json:/core-api/permissions.json',
          './core-api-uploads:/core-api/dist/core/src/private/uploads'
        ],
        networks: ['erxes']
      },
      gateway: {
        image: `erxes/gateway:${image_tag}`,
        environment: {
          SERVICE_NAME: 'gateway',
          PORT: '80',
          LOAD_BALANCER_ADDRESS: 'http://gateway',
          JWT_TOKEN_SECRET: configs.jwt_token_secret,
          CLIENT_PORTAL_DOMAINS: configs.client_portal_domains || '',
          MONGO_URL: mongoEnv(configs),
          ...commonEnvs(configs),
          ...((configs.gateway || {}).extra_env || {})
        },
        volumes: ['./enabled-services.js:/data/enabled-services.js'],
        healthcheck,
        deploy,
        extra_hosts,
        ports: ['3300:80'],
        networks: ['erxes']
      },
      crons: {
        image: `erxes/crons:${image_tag}`,
        environment: {
          MONGO_URL: mongoEnv(configs),
          ...commonEnvs(configs)
        },
        volumes: ['./enabled-services.js:/data/enabled-services.js'],
        networks: ['erxes']
      },
      plugin_workers_api: {
        image: `erxes/workers:${image_tag}`,
        environment: {
          SERVICE_NAME: 'workers',
          PORT: '80',
          JWT_TOKEN_SECRET: configs.jwt_token_secret,
          LOAD_BALANCER_ADDRESS: 'http://plugin_workers_api',
          MONGO_URL: mongoEnv(configs),
          ...commonEnvs(configs),
          ...((configs.workers || {}).extra_env || {})
        },
        volumes: ['./enabled-services.js:/data/enabled-services.js'],
        extra_hosts,
        networks: ['erxes']
      },
      essyncer: {
        image: `erxes/erxes-essyncer:federation`,
        environment: {
          ELASTICSEARCH_URL: `http://${configs.db_server_address}:9200`,
          MONGO_URL: mongoEnv(configs)
        },
        volumes: ['./essyncerData:/data/essyncerData'],
        extra_hosts,
        networks: ['erxes']
      }
    }
  };

  if (configs.widgets) {
    dockerComposeConfig.services.widgets = {
      image: `erxes/erxes-widgets:federation`,
      environment: {
        PORT: '3200',
        ROOT_URL: widgets_domain,
        API_URL: gateway_url,
        API_SUBSCRIPTIONS_URL: subscription_url
      },
      ports: ['3200:3200'],
      networks: ['erxes']
    };
  }

  if (dashboard) {
    dockerComposeConfig.services['dashboard-api'] = {
      image: 'erxes/erxes-dashboard-api:develop',
      ports: ['4300:80'],
      environment: {
        PORT: '80',
        CUBEJS_DB_TYPE: 'elasticsearch',
        CUBEJS_DB_URL: `http://${db_server_address || 'elasticsearch'}:9200`,
        CUBEJS_URL: dashboard_api_domain,
        CUBEJS_TOKEN: dashboard.api_token,
        CUBEJS_API_SECRET: dashboard.api_secret,
        REDIS_URL: `redis://${db_server_address || 'redis'}:6379`,
        REDIS_PASSWORD: configs.redis.password || '',
        DB_NAME: configs.mongo.db_name || 'erxes'
      },
      volumes: ['./enabled-services.js:/data/enabled-services.js'],
      extra_hosts,
      networks: ['erxes']
    };

    dockerComposeConfig.services['dashboard-front'] = {
      image: 'erxes/erxes-dashboard-front:develop',
      ports: ['4200:80'],
      environment: {
        REACT_APP_API_URL: gateway_url,
        REACT_APP_API_SUBSCRIPTION_URL: subscription_url,
        REACT_APP_DASHBOARD_API_URL: `https://${NGINX_HOST}/dashboard/api`,
        REACT_APP_DASHBOARD_API_TOKEN: configs.dashboard.api_token,
        NGINX_HOST
      },
      networks: ['erxes']
    };
  }

  if (configs.installer) {
    await fse.copy(`${__dirname}/../../installer`, filePath('installer'));

    await execCommand(`cd installer && npm install`);

    if (!fromInstaller) {
      await execCommand(`cd installer && npm run pm2 delete all`, true);
      await execCommand(`cd installer && RABBITMQ_HOST=${RABBITMQ_HOST} npm run pm2 start index.js`);
    }
  }

  log('Downloading pluginsMap.js from s3 ....');

  await execCurl(
    'https://erxes-plugins.s3.us-west-2.amazonaws.com/pluginsMap.js',
    'pluginsMap.js'
  );

  const pluginsMap = require(filePath('pluginsMap.js'));

  const enabledPlugins = ["'workers'"];
  const uiPlugins = [];
  const essyncerJSON = {
    plugins: [
      {
        db_name: configs.mongo.db_name || 'erxes',
        collections: [
          {
            name: 'users',
            schema: '{}',
            script: ''
          },
          {
            name: 'conformities',
            schema: ` 
            {
              "mainType": {
                "type": "keyword"
              },
              "mainTypeId": {
                "type": "keyword"
              },
              "relType": {
                "type": "keyword"
              },
              "relTypeId": {
                "type": "keyword"
              }
            }
          `,
            script: ''
          }
        ]
      }
    ]
  };

  const permissionsJSON = [];

  for (const plugin of configs.plugins || []) {
    dockerComposeConfig.services[
      `plugin_${plugin.name}_api`
    ] = generatePluginBlock(configs, plugin);

    enabledPlugins.push(`'${plugin.name}'`);

    if (pluginsMap[plugin.name]) {
      const uiConfig = pluginsMap[plugin.name].ui;

      if (uiConfig) {
        uiPlugins.push(
          JSON.stringify({
            name: plugin.name,
            ...pluginsMap[plugin.name].ui
          })
        );
      }

      const apiConfig = pluginsMap[plugin.name].api;

      if (apiConfig) {
        if (apiConfig.essyncer) {
          essyncerJSON.plugins.push({
            db_name: configs.mongo.db_name || 'erxes',
            collections: apiConfig.essyncer
          });
        }

        if (apiConfig.permissions) {
          permissionsJSON.push(apiConfig.permissions);
        }
      }
    }
  }

  if (!(await fse.exists(filePath('plugin-uis')))) {
    await execCommand('mkdir plugin-uis', true);
  }

  if (uis) {
    for (const plugin of configs.plugins || []) {
      const name = `plugin-${plugin.name}-ui`;

      if (pluginsMap[plugin.name] && pluginsMap[plugin.name].ui) {
        log(`Downloading ${name} ui from s3 ....`);
        await syncS3(plugin.name);
      }
    }
  }

  log('Generating ui plugins.js ....');

  await fs.promises.writeFile(
    filePath('plugins.js'),
    `
    window.plugins = [
      ${uiPlugins.join(',')}
    ]
  `.replace(/plugin-uis.s3.us-west-2.amazonaws.com/g, NGINX_HOST)
  );

  log('Generating enabled-services.js ....');

  await fs.promises.writeFile(
    filePath('enabled-services.js'),
    `
    module.exports = [
      ${enabledPlugins.join(',')}
    ]
  `
  );

  const extraServices = configs.extra_services || {};

  for (const serviceName of Object.keys(extraServices)) {
    const service = extraServices[serviceName];

    dockerComposeConfig.services[serviceName] = {
      ...service,
      networks: ['erxes']
    };
  }

  const yamlString = yaml.stringify(dockerComposeConfig);

  log('Generating permissions json ....');
  await fse.writeJSON(filePath('permissions.json'), permissionsJSON);

  // essyncer
  if (!(await fse.exists(filePath('essyncerData')))) {
    await execCommand('mkdir essyncerData', true);
  }

  log('Generating essyncer json ....');
  await fse.writeJSON(filePath('essyncerData/plugins.json'), essyncerJSON);

  log('Generating docker-compose.yml ....');

  fs.writeFileSync(filePath('docker-compose.yml'), yamlString);

  log('Generating nginx.conf ....');

  const commonParams = `
    proxy_set_header Connection 'upgrade';
    proxy_set_header Host $host;
    proxy_set_header Host $http_host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_http_version 1.1;
  `;

  const commonConfig = `
    proxy_set_header Upgrade $http_upgrade;
    ${commonParams}
  `;

  await fs.promises.writeFile(
    filePath('nginx.conf'),
    `
    server {
            listen 80;
            server_name ${NGINX_HOST};

            index index.html;
            error_log /var/log/nginx/erxes.error.log;
            access_log /var/log/nginx/erxes.access.log;
            location / {
                    proxy_pass http://127.0.0.1:3000/;
                    ${commonParams}
            }
            location /widgets/ {
                    proxy_pass http://127.0.0.1:3200/;
                    ${commonConfig}
            }
            location /gateway/ {
                    proxy_pass http://127.0.0.1:3300/;
                    ${commonConfig}
            }

            location /dashboard/api {
                proxy_pass http://127.0.0.1:4300/;
                ${commonConfig}
            }

            location /dashboard/front {
                proxy_pass http://127.0.0.1:4200/;
                ${commonConfig}
            }
    }
  `
  );

  log('Deploy ......');

  return execCommand(
    'docker stack deploy --compose-file docker-compose.yml erxes --with-registry-auth --resolve-image changed'
  );
};

const update = async ({ pluginNames, noimage, uis }) => {
  const configs = await fse.readJSON(filePath('configs.json'));
  const image_tag = configs.image_tag || 'federation';

  for (const name of pluginNames.split(',')) {
    if (!noimage) {
      log(`Updating image ${name}......`);

      if (['crons', 'dashboard-front', 'gateway', 'client-portal'].includes(name)) {
        await execCommand(
          `docker service update erxes_${name} --image erxes/${name}:${image_tag}`
        );
        continue;
      }

      if (name === 'dashboard-api') {
        await execCommand(
          `docker service update erxes_${name} --image erxes/${name}:${image_tag}`
        );
        continue;
      }

      if (name === 'coreui') {
        await execCommand(
          `docker service update erxes_coreui --image erxes/erxes:federation`
        );
        continue;
      }

      if (name === 'widgets') {
        await execCommand(
          `docker service update erxes_widgets --image erxes/erxes-widgets:federation`
        );
        continue;
      }

      if (name === 'core') {
        await execCommand(
          `docker service update erxes_plugin_core_api --image erxes/core:${image_tag}`
        );
        continue;
      }

      if (name === 'workers') {
        await execCommand(
          `docker service update erxes_plugin_workers_api --image erxes/workers:${image_tag}`
        );
        continue;
      }

      await execCommand(
        `docker service update erxes_plugin_${name}_api --image erxes/plugin-${name}-api:${image_tag}`
      );
    }

    if (uis) {
      await execCommand(`rm -rf plugin-uis/${`plugin-${name}-ui`}`, true);
      await syncS3(name);
    }
  }

  if (uis) {
    log('Restart core ui ....');
    await execCommand(`docker service update --force erxes_coreui`);
  }

  log('Updating gateway ....');
  await execCommand(`docker service update --force erxes_gateway`);
};

const restart = async name => {
  log(`Restarting .... ${name}`);

  if (['gateway', 'coreui', 'workers', 'crons'].includes(name)) {
    await execCommand(`docker service update --force erxes_${name}`);
    return;
  }

  await execCommand(`docker service update --force erxes_plugin_${name}_api`);
};

module.exports.manageInstallation = async program => {
  const type = process.argv[3];
  const name = process.argv[4];

  const configs = await fse.readJSON(filePath('configs.json'));

  if (type === 'install') {
    const prevEntry = configs.plugins.find(p => p.name === name);

    if (!prevEntry) {
      configs.plugins.push({ name: name });
    }
  }

  if (type === 'uninstall') {
    configs.plugins = configs.plugins.filter(p => p.name !== name);
  }

  log('Updating configs.json ....');

  await fse.writeJSON(filePath('configs.json'), configs);

  if (type === 'install') {
    log('Running up ....');
    await up({ fromInstaller: true });

    log('Syncing ui ....');

    await syncS3(name);

    await restart('coreui');

    log('Waiting for 30 seconds ....');
    await sleep(30000);
    await restart('gateway');
  }

  if (type === 'uninstall') {
    log('Running up ....');
    await up({ fromInstaller: true });

    log(`Removing ${name} service ....`);
    await execCommand(`docker service rm erxes_plugin_${name}_api`, true);

    await restart('coreui');
    await restart('gateway');
  }

  if (type === 'update') {
    log('Update date ....');
    await update({ pluginNames: name, uis: true });
  }
};

module.exports.up = program => {
  return up({ uis: program.uis });
};

module.exports.deployDbs = deployDbs;

module.exports.update = (program) => {
  if (process.argv.length < 4) {
    return console.log('Pass service names !!!');
  }

  const pluginNames = process.argv[3];

  return update({ pluginNames, noimage: program.noimage, uis: program.uis });
};

module.exports.restart = () => {
  const name = process.argv[3];
  return restart(name);
};
