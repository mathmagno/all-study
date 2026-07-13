# Configurar acesso SSH à AWS Lightsail em outra máquina

Este guia descreve como conectar à instância Lightsail (`54.20.4.21`) a partir de um computador novo, usando Cursor ou VS Code com Remote SSH.

## Informações da instância

| Campo | Valor |
|-------|-------|
| IP fixo | `54.20.4.21` |
| Usuário SSH | `ubuntu` |
| Chave privada | `LightsailDefaultKey-sa-east-1.pem` |
| Região AWS | `sa-east-1` (São Paulo) |

> **Importante:** a chave `.pem` **não está no GitHub** (está no `.gitignore` por segurança). Você precisa copiá-la manualmente da máquina atual para a nova.

---

## 1. Clonar este repositório (privado)

Na nova máquina, clone o repositório privado. Você precisa estar autenticado no GitHub.

### Windows (PowerShell)

```powershell
cd $env:USERPROFILE\OneDrive\Documentos\GitHub
git clone https://github.com/mathmagno/go_definitve.git
cd go_definitve
```

### Linux / macOS

```bash
mkdir -p ~/Documentos/GitHub
cd ~/Documentos/GitHub
git clone https://github.com/mathmagno/go_definitve.git
cd go_definitve
```

### Autenticação no GitHub

Se o `git clone` pedir login, use uma das opções:

- **GitHub CLI:** `gh auth login`
- **Personal Access Token (PAT):** use o token como senha ao clonar via HTTPS
- **SSH key:** configure uma chave SSH no GitHub e clone com `git@github.com:mathmagno/go_definitve.git`

---

## 2. Copiar a chave privada (.pem)

Transfira o arquivo `LightsailDefaultKey-sa-east-1.pem` da máquina atual para a nova. Opções seguras:

- Pen drive
- OneDrive / Google Drive (pasta privada)
- E-mail para você mesmo

### Onde colocar na nova máquina

**Opção A — dentro do repositório clonado (recomendado, igual à máquina atual):**

```text
<pasta-do-repo>/LightsailDefaultKey-sa-east-1.pem
```

Exemplo Windows:

```text
C:\Users\SEU_USUARIO\OneDrive\Documentos\GitHub\go_definitve\LightsailDefaultKey-sa-east-1.pem
```

**Opção B — pasta `.ssh` do usuário:**

```text
Windows: C:\Users\SEU_USUARIO\.ssh\LightsailDefaultKey-sa-east-1.pem
Linux/macOS: ~/.ssh/LightsailDefaultKey-sa-east-1.pem
```

> O Git **nunca** envia arquivos `.pem` para o GitHub. Mesmo dentro do repositório, a chave fica apenas local.

---

## 3. Ajustar permissões da chave

### Windows (PowerShell)

Substitua `SEU_USUARIO` e o caminho da chave:

```powershell
$key = "C:\Users\SEU_USUARIO\OneDrive\Documentos\GitHub\go_definitve\LightsailDefaultKey-sa-east-1.pem"
icacls $key /inheritance:r
icacls $key /grant:r "$env:USERNAME:(R)"
```

Ou execute o script incluído neste repositório:

```powershell
.\scripts\setup-ssh-windows.ps1
```

### Linux / macOS

```bash
chmod 600 ~/Documentos/GitHub/go_definitve/LightsailDefaultKey-sa-east-1.pem
```

---

## 4. Configurar o SSH

### Opção A — copiar o template do repositório

Este repositório inclui um arquivo de exemplo em `ssh/config.example`.

**Windows:**

```powershell
# Criar pasta .ssh se não existir
New-Item -ItemType Directory -Force -Path "$env:USERPROFILE\.ssh"

# Copiar e editar (ajuste SEU_USUARIO no caminho da chave)
Copy-Item "ssh\config.example" "$env:USERPROFILE\.ssh\config"
notepad "$env:USERPROFILE\.ssh\config"
```

**Linux / macOS:**

```bash
mkdir -p ~/.ssh
cp ssh/config.example ~/.ssh/config
chmod 600 ~/.ssh/config
nano ~/.ssh/config
```

### Opção B — colar manualmente

Edite `~/.ssh/config` (Windows: `C:\Users\SEU_USUARIO\.ssh\config`) com:

```text
Host lightsail
  HostName 54.20.4.21
  User ubuntu
  IdentityFile "CAMINHO_COMPLETO_PARA/LightsailDefaultKey-sa-east-1.pem"
```

Exemplo Windows (ajuste o usuário):

```text
Host lightsail
  HostName 54.20.4.21
  User ubuntu
  IdentityFile "C:\Users\SEU_USUARIO\OneDrive\Documentos\GitHub\go_definitve\LightsailDefaultKey-sa-east-1.pem"
```

Exemplo Linux/macOS:

```text
Host lightsail
  HostName 54.20.4.21
  User ubuntu
  IdentityFile "/home/SEU_USUARIO/Documentos/GitHub/go_definitve/LightsailDefaultKey-sa-east-1.pem"
```

> Use **`IdentityFile`** (grafia correta). Um typo comum (`IdentitiFile`) impede a conexão.

---

## 5. Instalar Cursor/VS Code e extensões

1. Instale [Cursor](https://cursor.com) ou [VS Code](https://code.visualstudio.com)
2. Instale a extensão **Remote - SSH** (Microsoft)
3. (Opcional) **Remote - SSH: Editing Configuration Files**

---

## 6. Testar a conexão no terminal

Antes de abrir o Cursor, confirme que o SSH funciona:

```bash
ssh lightsail "echo 'Conexao OK' && uname -a"
```

Saída esperada:

```text
Conexao OK
Linux ip-172-26-12-166 ... Ubuntu ...
```

Se falhar, veja [Solução de problemas](#solução-de-problemas) abaixo.

---

## 7. Conectar pelo Cursor / VS Code

1. Pressione **Ctrl + Shift + P**
2. Digite: `Remote-SSH: Connect to Host...`
3. Selecione **`lightsail`** (ou `54.20.4.21`)
4. Quando perguntar a plataforma, escolha **Linux**
5. Aguarde a instalação do VS Code Server na instância (só na primeira vez)
6. Abra a pasta do projeto no servidor remoto

### Se a conexão ficar travada ou usar config antiga

1. **Ctrl + Shift + P** → `Remote-SSH: Kill VS Code Server on Host...`
2. Selecione `lightsail` ou `54.20.4.21`
3. Tente conectar novamente

---

## O que **não** precisa refazer na AWS

- Criar novo IP fixo (já é `54.20.4.21`)
- Baixar nova chave na Lightsail (só se perdeu o `.pem`)
- Alterar firewall, se a conexão já funciona em outra máquina

---

## Checklist rápido

- [ ] Autenticar no GitHub na nova máquina
- [ ] Clonar `https://github.com/mathmagno/go_definitve.git`
- [ ] Copiar `LightsailDefaultKey-sa-east-1.pem` para a nova máquina
- [ ] Ajustar permissões da chave
- [ ] Criar/editar `~/.ssh/config` (usar `ssh/config.example` como base)
- [ ] Instalar Cursor + extensão Remote SSH
- [ ] Testar: `ssh lightsail "echo OK"`
- [ ] Conectar via Remote SSH no Cursor

---

## Solução de problemas

### `Permission denied (publickey)`

- Verifique se o caminho da chave em `IdentityFile` está correto
- Confirme que o arquivo `.pem` existe no caminho indicado
- Verifique permissões da chave (passo 3)
- Confirme que a linha é `IdentityFile`, não `IdentitiFile`

### `Connection timed out`

- Confirme que a instância Lightsail está **Running** no console AWS
- Verifique sua conexão com a internet
- Confirme o IP: `54.20.4.21`

### Cursor não encontra o host

- Abra **Ctrl + Shift + P** → `Remote-SSH: Open SSH Configuration File...`
- Confirme que o bloco `Host lightsail` está salvo
- Reinicie o Cursor após editar o config

### Perdeu a chave `.pem`

1. Acesse [AWS Lightsail Console](https://lightsail.aws.amazon.com/)
2. Vá em **Account** → **SSH keys**
3. Baixe a chave padrão da região `sa-east-1`
4. Repita os passos 2 a 7 neste guia em **todas** as máquinas que usam SSH

---

## Arquivos úteis neste repositório

| Arquivo | Descrição |
|---------|-----------|
| `docs/setup-lightsail-ssh.md` | Este guia |
| `ssh/config.example` | Template do arquivo SSH config |
| `scripts/setup-ssh-windows.ps1` | Script de setup automático (Windows) |
| `.gitignore` | Impede commit acidental de chaves `.pem` |
