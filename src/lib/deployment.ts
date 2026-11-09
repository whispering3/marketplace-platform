import "server-only";

export type DeploymentColor = "blue" | "green";

export function activeDeploymentColor(): DeploymentColor {
  return process.env.DEPLOYMENT_COLOR === "green" ? "green" : "blue";
}

export function passiveDeploymentColor(): DeploymentColor {
  return activeDeploymentColor() === "blue" ? "green" : "blue";
}

export function deploymentHealth() {
  return {
    color: activeDeploymentColor(),
    commit: process.env.GIT_COMMIT_SHA || "local",
    nodeEnv: process.env.NODE_ENV || "development",
    startedAt: process.env.BUILD_TIME || "unknown",
  };
}
