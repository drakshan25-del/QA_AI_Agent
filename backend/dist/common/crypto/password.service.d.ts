export declare class PasswordService {
    private readonly rounds;
    hash(plain: string): Promise<string>;
    compare(plain: string, hash: string): Promise<boolean>;
}
