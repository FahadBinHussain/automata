#!/usr/bin/env node

const { program } = require('commander');
const chalk = require('chalk');
const { uploadFile } = require('./lib/uploader');
require('dotenv').config();

// Get API key and account ID from environment variables
const API_KEY = process.env.FILES_VC_API_KEY;
const ACCOUNT_ID = process.env.FILES_VC_ACCOUNT_ID;

// Configure the command-line interface
program
  .name('filesvc-uploader')
  .description('A simple command-line tool to upload files to files.vc')
  .version('1.0.0')
  .argument('<filepath>', 'Path to the file you want to upload')
  .option('-a, --account-id <id>', 'Optional account ID to associate with the upload (overrides environment variable)')
  .option('-k, --api-key <key>', 'API key to use (overrides environment variable)')
  .parse(process.argv);

const options = program.opts();
const filePath = program.args[0];

// Main execution
(async () => {
  try {
    // Use command line options if provided, otherwise use environment variables
    const apiKey = options.apiKey || API_KEY;
    const accountId = options.accountId || ACCOUNT_ID;
    
    // Check if API key is set
    if (!apiKey) {
      console.error(chalk.red('Error: API key is not set. Please set the FILES_VC_API_KEY environment variable or use --api-key option.'));
      console.log(chalk.yellow('You can create a .env file with FILES_VC_API_KEY=your-api-key or set it in your environment.'));
      process.exit(1);
    }
    
    // Create a colorful logger function
    const logger = (message) => {
      if (message.includes('Uploading')) {
        console.log(chalk.blue(message));
      } else if (message.includes('successful')) {
        console.log(chalk.green(message));
      } else if (message.includes('URL:')) {
        const [label, url] = message.split(': ');
        console.log(chalk.yellow(`${label}:`), chalk.cyan(url));
      } else if (message.includes('account ID')) {
        console.log(chalk.blue(message));
      } else {
        console.log(message);
      }
    };
    
    // Upload the file
    await uploadFile(filePath, { apiKey, accountId, logger });
    
  } catch (error) {
    console.error(chalk.red(error.message));
    process.exit(1);
  }
})(); 