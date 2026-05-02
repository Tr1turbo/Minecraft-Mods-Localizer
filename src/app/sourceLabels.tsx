import { createContext } from "react";
import { createDefaultSourceLabels } from "../lib/deploymentConfig";

export const SourceLabelContext = createContext(createDefaultSourceLabels());
