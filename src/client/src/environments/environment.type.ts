export type EnvName = 'production' | 'dev' | 'local';

export interface Environment {
  production: boolean;
  envName: EnvName;
  supabaseUrl: string;
  supabaseAnonKey: string;
  apexDomain: string;
}
