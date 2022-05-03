import { commands, LanguageClient, services, TransportKind, window, workspace } from 'coc.nvim';
import { dirname } from 'path';
import { sync as resolve } from 'resolve';
import { fileURLToPath, pathToFileURL } from 'url';

import type { GlintConfig } from '@glint/config';
import type {
  Disposable,
  ExtensionContext,
  LanguageClientOptions,
  ServerOptions,
  WorkspaceFolder,
  // WorkspaceFoldersChangeEvent,
} from 'coc.nvim';

module.exports = {
  async activate(context: ExtensionContext) {
    console.info('activate');

    let folders = []; // [...workspace.workspaceFolders];
    let projectConfig = await workspace.findUp('.glintrc.yml');

    if (projectConfig) {
      let projectRoot = dirname(projectConfig);
      let paths = workspace.workspaceFolders.map((folder) => fileURLToPath(folder.uri));

      if (!paths.includes(projectRoot)) {
        folders.push({
          uri: pathToFileURL(projectRoot).toString(),
          name: dirname(projectRoot),
        });
      }
    }

    for (let folder of folders) {
      try {
        await addWorkspaceFolder(folder, context);
      } catch (e) {
        console.error(e);
      }
    }

    // async function handleWorkspaceChange({ added, removed }: WorkspaceFoldersChangeEvent) {
    //   for (let folder of added) {
    //     await addWorkspaceFolder(folder, context);
    //   }

    //   for (let folder of removed) {
    //     removeWorkspaceFolder(folder, context);
    //   }
    // }

    // workspace.onDidChangeWorkspaceFolders(handleWorkspaceChange);
  },
};

const outputChannel = window.createOutputChannel('Glint Language Server');
const clients = new Map<string, Disposable>();
let debugServerPortNumber = 6009;

async function addWorkspaceFolder(
  workspaceFolder: WorkspaceFolder,
  context: ExtensionContext
): Promise<void> {
  let folderPath = fileURLToPath(workspaceFolder.uri);
  let projectConfig = await workspace.findUp('.glintrc.yml');

  (folderPath = projectConfig ? dirname(projectConfig) : folderPath),
    console.info(`Adding: ${folderPath}`);

  if (clients.has(folderPath)) return;

  let binPath = resolve('@glint/core/bin/glint-language-server', { basedir: folderPath });

  console.info('Glint bin @ ', binPath);

  let serverOptions: ServerOptions = {
    run: {
      module: binPath,
      transport: TransportKind.ipc,
    },
    debug: {
      module: binPath,
      transport: TransportKind.ipc,
      options: { execArgv: ['--nolazy', `--inspect=${debugServerPortNumber++}`] },
    },
    options: {
      cwd: folderPath,
    },
  };

  // TODO: compile to ESM and build my own require
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  let { loadConfig } = require(resolve('@glint/config', { basedir: folderPath }));
  let config: GlintConfig = loadConfig(folderPath);
  let extensions = config.environment.getConfiguredFileExtensions();
  let filePattern = `${folderPath}/**/*{${extensions.join(',')}}`;

  let clientOptions: LanguageClientOptions = {
    workspaceFolder,
    outputChannel,
    documentSelector: [{ scheme: 'file', pattern: filePattern }],
    // initializationOptions: {
    //   editor: 'vscode', // hack...?
    // },

    synchronize: {
      fileEvents: workspace.createFileSystemWatcher(filePattern),
    },
  };

  const client = new LanguageClient('glint', 'Glint', serverOptions, clientOptions);
  // const disposable = client.start();

  // context.subscriptions.push(services.registLanguageClient(client));
  // await client.onReady();

  // context.subscriptions.push(disposable);

  client
    .onReady()
    .then(() => {
      /**
       * Only register commands if initial start is successful
       */
      registerRestartCommand(context, client);
    })
    .catch((e) => {
      console.error(e);
    });

  context.subscriptions.push(services.registLanguageClient(client));
  // clients.set(folderPath, disposable);
}

function removeWorkspaceFolder(workspaceFolder: WorkspaceFolder, context: ExtensionContext): void {
  let folderPath = fileURLToPath(workspaceFolder.uri);

  console.info(`Removing: ${folderPath}`);

  let client = clients.get(folderPath);

  if (client) {
    clients.delete(folderPath);
    context.subscriptions.splice(context.subscriptions.indexOf(client), 1);
    client.dispose();
  }
}

function registerRestartCommand(context: ExtensionContext, client: LanguageClient) {
  context.subscriptions.push(
    commands.registerCommand('glint.restart', () =>
      displayInitProgress(
        client
          .stop()
          .then(() => client.start())
          .then(() => client.onReady())
      )
    )
  );
}

async function displayInitProgress<T = void>(promise: Promise<T>) {
  return window.withProgress(
    {
      title: 'Glint initialization',
      cancellable: true,
    },
    () => promise
  );
}
