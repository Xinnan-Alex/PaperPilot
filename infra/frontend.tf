import {
  to = aws_s3_bucket.frontend
  id = "paperpilot-frontend-prod-bazinga"
}
import {
  to = aws_s3_bucket_public_access_block.frontend
  id = "paperpilot-frontend-prod-bazinga"
}
import {
  to = aws_s3_bucket_policy.frontend
  id = "paperpilot-frontend-prod-bazinga"
}
import {
  to = aws_cloudfront_origin_access_control.frontend
  id = "EG0E4AMYN7BTF"
}
import {
  to = aws_acm_certificate.frontend
  id = "arn:aws:acm:us-east-1:501519530452:certificate/9035f6c7-e735-4efc-9095-8ca877c4e61c"
}
import {
  to = aws_cloudfront_distribution.cdn
  id = "E20I040JKEVYGH"
}

# private bucket for the built SPA
resource "aws_s3_bucket" "frontend" {
  bucket = "paperpilot-frontend-prod-bazinga"
}

resource "aws_s3_bucket_public_access_block" "frontend" {
  bucket                  = aws_s3_bucket.frontend.id
  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

# only this cloudfront distribution may read the bucket
resource "aws_s3_bucket_policy" "frontend" {
  bucket = aws_s3_bucket.frontend.id
  policy = jsonencode({
    Version = "2008-10-17"
    Id      = "PolicyForCloudFrontPrivateContent"
    Statement = [{
      Sid       = "AllowCloudFrontServicePrincipal"
      Effect    = "Allow"
      Principal = { Service = "cloudfront.amazonaws.com" }
      Action    = "s3:GetObject"
      Resource  = "arn:aws:s3:::paperpilot-frontend-prod-bazinga/*"
      Condition = {
        ArnLike = { "AWS:SourceArn" = "arn:aws:cloudfront::501519530452:distribution/E20I040JKEVYGH" }
      }
    }]
  })
}

# oac — lets cloudfront read the private bucket
resource "aws_cloudfront_origin_access_control" "frontend" {
  name                              = "oac-paperpilot-frontend-prod-bazinga.s3.ap-southeast-mqhn9guucfk"
  description                       = "Created by CloudFront"
  origin_access_control_origin_type = "s3"
  signing_behavior                  = "always"
  signing_protocol                  = "sigv4"
}

# acm cert — must be us-east-1 for cloudfront
resource "aws_acm_certificate" "frontend" {
  provider          = aws.us_east_1
  domain_name       = "paperpilot.leongxinnan.com"
  validation_method = "DNS"
  lifecycle {
    create_before_destroy = true
  }
}

# cdn
resource "aws_cloudfront_distribution" "cdn" {
  aliases             = ["paperpilot.leongxinnan.com"]
  enabled             = true
  http_version        = "http2"
  is_ipv6_enabled     = true
  price_class         = "PriceClass_All"
  retain_on_delete    = false
  staging             = false
  wait_for_deployment = true
  web_acl_id          = "arn:aws:wafv2:us-east-1:501519530452:global/webacl/CreatedByCloudFront-b862fbe9/25ab368e-4db1-40c3-b7ed-c7b172de907d"
  tags = {
    Name = "paperpilot-frontend"
  }

  # spa fallback
  custom_error_response {
    error_caching_min_ttl = 10
    error_code            = 403
    response_code         = 200
    response_page_path    = "/index.html"
  }
  custom_error_response {
    error_caching_min_ttl = 10
    error_code            = 404
    response_code         = 200
    response_page_path    = "/index.html"
  }

  default_cache_behavior {
    allowed_methods            = ["GET", "HEAD"]
    cached_methods             = ["GET", "HEAD"]
    compress                   = true
    target_origin_id           = "paperpilot-frontend-prod-bazinga.s3.ap-southeast-5.amazonaws.com-mqhn4b55bvv"
    viewer_protocol_policy     = "redirect-to-https"
    cache_policy_id            = "658327ea-f89d-4fab-a63d-7e88639e58f6" # AWS managed: CachingOptimized
    response_headers_policy_id = "67f7725c-6f97-4210-82d7-5512b31e9d03" # AWS managed: SecurityHeadersPolicy
    grpc_config {
      enabled = false
    }
  }

  origin {
    domain_name              = "paperpilot-frontend-prod-bazinga.s3.ap-southeast-5.amazonaws.com"
    origin_access_control_id = "EG0E4AMYN7BTF"
    origin_id                = "paperpilot-frontend-prod-bazinga.s3.ap-southeast-5.amazonaws.com-mqhn4b55bvv"
  }

  restrictions {
    geo_restriction {
      locations        = []
      restriction_type = "none"
    }
  }

  viewer_certificate {
    acm_certificate_arn      = "arn:aws:acm:us-east-1:501519530452:certificate/9035f6c7-e735-4efc-9095-8ca877c4e61c"
    minimum_protocol_version = "TLSv1.2_2021"
    ssl_support_method       = "sni-only"
  }
}
