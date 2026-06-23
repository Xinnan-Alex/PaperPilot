import {
  to = aws_s3_bucket.documents_dev
  id = "paperpilot-documents-dev-bazinga-bazonga"
}
resource "aws_s3_bucket" "documents_dev" {
  bucket = "paperpilot-documents-dev-bazinga-bazonga"
}

import {
  to = aws_s3_bucket.documents_prod
  id = "paperpilot-documents-prod-bazinga-bazonga"
}
resource "aws_s3_bucket" "documents_prod" {
  bucket = "paperpilot-documents-prod-bazinga-bazonga"
}

import {
  to = aws_s3_bucket_public_access_block.documents_dev
  id = "paperpilot-documents-dev-bazinga-bazonga"
}
resource "aws_s3_bucket_public_access_block" "documents_dev" {
  block_public_acls       = true
  block_public_policy     = true
  bucket                  = "paperpilot-documents-dev-bazinga-bazonga"
  ignore_public_acls      = true
  region                  = "ap-southeast-5"
  restrict_public_buckets = true
  skip_destroy            = null
}

import {
  to = aws_s3_bucket_public_access_block.documents_prod
  id = "paperpilot-documents-prod-bazinga-bazonga"
}
resource "aws_s3_bucket_public_access_block" "documents_prod" {
  block_public_acls       = true
  block_public_policy     = true
  bucket                  = "paperpilot-documents-prod-bazinga-bazonga"
  ignore_public_acls      = true
  region                  = "ap-southeast-5"
  restrict_public_buckets = true
  skip_destroy            = null
}

import {
  to = aws_iam_policy.s3_access
  id = "arn:aws:iam::501519530452:policy/paperpilot-s3-access"
}
resource "aws_iam_policy" "s3_access" {
  delay_after_policy_creation_in_ms = null
  description                       = null
  name                              = "paperpilot-s3-access"
  path                              = "/"
  policy = jsonencode({
    Statement = [{
      Action   = ["s3:GetObject", "s3:PutObject", "s3:DeleteObject", "s3:ListBucket"]
      Effect   = "Allow"
      Resource = ["arn:aws:s3:::paperpilot-documents-prod-bazinga-bazonga", "arn:aws:s3:::paperpilot-documents-prod-bazinga-bazonga/*"]
      }, {
      Action   = ["logs:CreateLogGroup", "logs:CreateLogStream", "logs:PutLogEvents"]
      Effect   = "Allow"
      Resource = "arn:aws:logs:ap-southeast-5:501519530452:log-group:/paperpilot/*"
    }]
    Version = "2012-10-17"
  })
  tags = {}
}
