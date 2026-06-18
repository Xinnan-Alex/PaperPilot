import {
  to = aws_iam_role.backend
  id = "paperpilot-backend-instancel-role"
}
import {
  to = aws_iam_instance_profile.backend
  id = "paperpilot-backend-instancel-role"
}

import {
  to = aws_iam_role_policy_attachment.s3
  id = "paperpilot-backend-instancel-role/arn:aws:iam::501519530452:policy/paperpilot-s3-access"
}
import {
  to = aws_iam_role_policy_attachment.cw
  id = "paperpilot-backend-instancel-role/arn:aws:iam::aws:policy/CloudWatchAgentServerPolicy"
}
import {
  to = aws_iam_role_policy_attachment.ssm_core
  id = "paperpilot-backend-instancel-role/arn:aws:iam::aws:policy/AmazonSSMManagedInstanceCore"
}
import {
  to = aws_iam_role_policy_attachment.ecr
  id = "paperpilot-backend-instancel-role/arn:aws:iam::aws:policy/AmazonEC2ContainerRegistryReadOnly"
}

import {
  to = aws_iam_role_policy.ssm_secrets
  id = "paperpilot-backend-instancel-role:ssm-get-paperpilot-secrets"
}

import {
  to = aws_security_group.backend
  id = "sg-08b80f1f35e17c0d1"
}

import {
  to = aws_instance.backend
  id = "i-0d9cf1ff5e90ab896"
}

import {
  to = aws_eip.backend
  id = "eipalloc-0369e5710e7d328a9" # allocation id, NOT 56.69.2.250
}
import {
  to = aws_eip_association.backend
  id = "eipassoc-099cf8d12c74cfbd8"
}

resource "aws_security_group" "backend" {
  description = "launch-wizard-1 created 2026-06-16T16:49:47.000Z"
  egress = [{
    cidr_blocks      = ["0.0.0.0/0"]
    description      = ""
    from_port        = 0
    ipv6_cidr_blocks = []
    prefix_list_ids  = []
    protocol         = "-1"
    security_groups  = []
    self             = false
    to_port          = 0
  }]
  ingress = [{
    cidr_blocks      = ["0.0.0.0/0"]
    description      = ""
    from_port        = 443
    ipv6_cidr_blocks = []
    prefix_list_ids  = []
    protocol         = "tcp"
    security_groups  = []
    self             = false
    to_port          = 443
    }, {
    cidr_blocks      = ["0.0.0.0/0"]
    description      = ""
    from_port        = 80
    ipv6_cidr_blocks = []
    prefix_list_ids  = []
    protocol         = "tcp"
    security_groups  = []
    self             = false
    to_port          = 80
    }, {
    cidr_blocks      = ["175.139.77.191/32"]
    description      = ""
    from_port        = 22
    ipv6_cidr_blocks = []
    prefix_list_ids  = []
    protocol         = "tcp"
    security_groups  = []
    self             = false
    to_port          = 22
  }]
  name                   = "launch-wizard-1"
  region                 = "ap-southeast-5"
  revoke_rules_on_delete = null
  vpc_id                 = "vpc-09cc825215a146902"
}

resource "aws_eip_association" "backend" {
  allocation_id = aws_eip.backend.id
  instance_id   = aws_instance.backend.id
}

resource "aws_eip" "backend" {
  domain               = "vpc"
  network_border_group = "ap-southeast-5"
  public_ipv4_pool     = "amazon"
  region               = "ap-southeast-5"
}

resource "aws_iam_role_policy_attachment" "cw" {
  policy_arn = "arn:aws:iam::aws:policy/CloudWatchAgentServerPolicy"
  role       = "paperpilot-backend-instancel-role"
}

resource "aws_iam_role_policy_attachment" "s3" {
  policy_arn = "arn:aws:iam::501519530452:policy/paperpilot-s3-access"
  role       = "paperpilot-backend-instancel-role"
}

resource "aws_iam_role_policy_attachment" "ecr" {
  policy_arn = "arn:aws:iam::aws:policy/AmazonEC2ContainerRegistryReadOnly"
  role       = "paperpilot-backend-instancel-role"
}

resource "aws_iam_role_policy_attachment" "ssm_core" {
  policy_arn = "arn:aws:iam::aws:policy/AmazonSSMManagedInstanceCore"
  role       = "paperpilot-backend-instancel-role"
}

resource "aws_iam_role_policy" "ssm_secrets" {
  name = "ssm-get-paperpilot-secrets"
  policy = jsonencode({
    Statement = [{
      Action   = ["ssm:GetParameter", "ssm:GetParameters", "ssm:GetParametersByPath"]
      Effect   = "Allow"
      Resource = "arn:aws:ssm:ap-southeast-5:501519530452:parameter/paperpilot/*"
      }, {
      Action   = "kms:Decrypt"
      Effect   = "Allow"
      Resource = "arn:aws:kms:ap-southeast-5:501519530452:alias/aws/ssm"
    }]
    Version = "2012-10-17"
  })
  role = "paperpilot-backend-instancel-role"
}

resource "aws_iam_instance_profile" "backend" {
  name = "paperpilot-backend-instancel-role"
  path = "/"
  role = "paperpilot-backend-instancel-role"
}

resource "aws_instance" "backend" {
  ami                    = "ami-02adba1c086396125"
  instance_type          = "t4g.micro"
  key_name               = "paperpilot-backend-instance-kp"
  subnet_id              = "subnet-003b9fb2f4b5ae8eb"
  vpc_security_group_ids = [aws_security_group.backend.id]
  iam_instance_profile   = aws_iam_instance_profile.backend.name

  root_block_device {
    delete_on_termination = true
    encrypted             = false
    iops                  = 3000
    throughput            = 125
    volume_size           = 8
    volume_type           = "gp3"
  }
  lifecycle { prevent_destroy = true }
}

resource "aws_iam_role" "backend" {
  assume_role_policy = jsonencode({
    Statement = [{
      Action = "sts:AssumeRole"
      Effect = "Allow"
      Principal = {
        Service = "ec2.amazonaws.com"
      }
    }]
    Version = "2012-10-17"
  })
  description           = null
  force_detach_policies = false
  max_session_duration  = 3600
  name                  = "paperpilot-backend-instancel-role"
  path                  = "/"
  permissions_boundary  = null
}
