/**
 * Options for uploading a file to files.vc
 */
export interface UploaderOptions {
  /**
   * Files.vc API key
   */
  apiKey: string;
  
  /**
   * Optional account ID to associate with the upload
   */
  accountId?: string;
  
  /**
   * Optional logger function
   * @default console.log
   */
  logger?: (message: string) => void;
}

/**
 * Response from the files.vc API
 */
export interface UploadResponse {
  /**
   * URL to the file page
   */
  page_url?: string;
  
  /**
   * Direct URL to the file
   */
  file_url?: string;
  
  /**
   * Any additional properties returned by the API
   */
  [key: string]: any;
}

/**
 * Upload a file to files.vc
 * @param filePath - Path to the file to upload
 * @param options - Upload options
 * @returns Promise resolving to the upload response
 * @throws Error if the upload fails
 */
export function uploadFile(filePath: string, options: UploaderOptions): Promise<UploadResponse>; 