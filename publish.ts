import axios from "axios";
import fs from "fs";
import path from "path";
import dotenv from "dotenv";

dotenv.config();

const GITHUB_USER = process.env.GITHUB_USER;
const GITHUB_TOKEN = process.env.GITHUB_TOKEN;

if (!GITHUB_USER || !GITHUB_TOKEN) {
  console.error("❌ Erro: GITHUB_USER ou GITHUB_TOKEN não definidos no ambiente.");
  process.exit(1);
}

const repoName = "tiktok-pro-downloader-pro";
const headers = {
  Authorization: `token ${GITHUB_TOKEN}`,
  Accept: "application/vnd.github.v3+json",
};

async function ensureRepo() {
  console.log(`[1] Verificando/Criando repositório: ${repoName}...`);
  try {
    // Check if exists
    await axios.get(`https://api.github.com/repos/${GITHUB_USER}/${repoName}`, { headers });
    console.log("✅ Repositório já existe.");
    return true;
  } catch (error: any) {
    if (error.response?.status === 404) {
      try {
        await axios.post(
          "https://api.github.com/user/repos",
          { name: repoName, private: false },
          { headers }
        );
        console.log("✅ Repositório criado com sucesso.");
        return true;
      } catch (createError: any) {
        console.error("❌ Erro ao criar repositório:", createError.response?.data || createError.message);
        return false;
      }
    }
    console.error("❌ Erro ao verificar repositório:", error.message);
    return false;
  }
}

async function uploadFile(filePath: string) {
  const content = fs.readFileSync(filePath);
  const base64Content = content.toString("base64");
  const relativePath = path.relative(process.cwd(), filePath).replace(/\\/g, '/');
  
  if (relativePath.includes("node_modules") || relativePath.includes(".git") || relativePath.includes("dist") || relativePath === ".env") return;

  let sha: string | undefined = undefined;
  try {
    const fileRes = await axios.get(
      `https://api.github.com/repos/${GITHUB_USER}/${repoName}/contents/${relativePath}`,
      { headers }
    );
    sha = fileRes.data.sha;
  } catch (e) {}

  try {
    await axios.put(
      `https://api.github.com/repos/${GITHUB_USER}/${repoName}/contents/${relativePath}`,
      {
        message: `Update: ${relativePath}`,
        content: base64Content,
        sha: sha
      },
      { headers }
    );
    console.log(`  ⬆️ ${sha ? 'Atualizado' : 'Enviado'}: ${relativePath}`);
  } catch (error: any) {
    console.error(`  ❌ Falha no envio ${relativePath}:`, error.response?.data?.message || error.message);
  }
}

function getAllFiles(dirPath: string, arrayOfFiles: string[] = []) {
  const files = fs.readdirSync(dirPath);

  files.forEach((file) => {
    if (fs.statSync(dirPath + "/" + file).isDirectory()) {
      if (file !== "node_modules" && file !== ".git" && file !== "dist") {
        arrayOfFiles = getAllFiles(dirPath + "/" + file, arrayOfFiles);
      }
    } else {
      arrayOfFiles.push(path.join(dirPath, "/", file));
    }
  });

  return arrayOfFiles;
}

async function main() {
  console.log("--- INICIANDO PUBLICAÇÃO NO GITHUB ---");
  if (await ensureRepo()) {
    const allFiles = getAllFiles(process.cwd());
    console.log(`[2] Enviando ${allFiles.length} arquivos...`);
    
    for (const file of allFiles) {
      await uploadFile(file);
    }
    
    console.log(`\n✨ SUCESSO!`);
    console.log(`🔗 Link: https://github.com/${GITHUB_USER}/${repoName}`);
  }
}

main();
